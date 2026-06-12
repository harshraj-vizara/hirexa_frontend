/**
 * sarvam_stt.js
 *
 * Drop-in replacement for window.SpeechRecognition that streams mic audio
 * to a backend proxy (/api/screening_round/ws/stt), which in turn talks to
 * Sarvam's Saaras v3 streaming endpoint.
 *
 * Public surface mirrors the Web Speech API so screening_round_room.js can
 * keep its existing onstart / onresult / onerror / onend handlers, with the
 * same event.results[i].isFinal + event.results[i][0].transcript shape.
 *
 * Differences from Web Speech:
 *   - .continuous / .interimResults are accepted but always behave as
 *     {true, true} since Sarvam streaming is continuous and emits partials.
 *   - .lang maps to the Sarvam language-code query param (en-IN, hi-IN, ...).
 *   - .maxAlternatives is accepted but ignored (Sarvam returns one best).
 *   - .phrases is accepted but ignored (codemix mode handles tech terms).
 *
 * Backend WebSocket protocol (see src/screening_round_stt.py):
 *   Client -> Server:
 *     binary frame      = raw int16 LE PCM @ 16 kHz mono
 *     {"action":"flush"} = force finalize the current segment
 *     {"action":"close"} = graceful close
 *   Server -> Client:
 *     {"type":"open"}                              // upstream connected
 *     {"type":"data","data":{"transcript":"..."}}  // transcript chunk
 *     {"type":"speech_start"} / {"type":"speech_end"}
 *     {"type":"error","data":{"code","message"}}
 */

(function () {
    'use strict';

    const STT_ENDPOINT_PATH = '/api/screening_round/ws/stt';

    class SarvamSpeechRecognition {
        constructor() {
            // Web Speech API parity (read+write properties)
            this.lang = 'en-IN';
            this.continuous = true;
            this.interimResults = true;
            this.maxAlternatives = 1;
            this.phrases = [];

            // Sarvam-specific knobs
            this.mode = 'codemix';        // transcribe | codemix | verbatim | translit | translate
            this.sampleRate = 16000;

            // Event handlers (assignable by caller, just like Web Speech)
            this.onstart = null;
            this.onresult = null;
            this.onerror = null;
            this.onend = null;
            // Extra (non-Web-Speech): fires ~5x/sec with the mic RMS level of the
            // latest audio frame, so the room can detect that the candidate is
            // audibly speaking INDEPENDENTLY of Sarvam's transcript latency. Used
            // to keep the auto-submit watchdog from firing mid-answer and to show
            // a live "listening" cue.
            this.onaudio = null;

            // Internal state
            this._ws = null;
            this._audioCtx = null;
            this._workletNode = null;
            this._micStream = null;
            this._sourceNode = null;
            this._running = false;
            this._workletLoaded = false;
            this._endedEmitted = false;
            // Whole-turn transcript. Sarvam emits overlapping / refined windows
            // ("is coming" -> "coming to play"), so each incoming transcript is
            // OVERLAP-MERGED into the accumulator (the duplicated boundary words
            // are dropped) rather than appended or replaced — that avoids both the
            // "coming coming coming" duplication and erasing earlier sentences.
            this._acc = '';
            // Generation counter — every start() bumps this. Async startup
            // work captures the gen at entry and bails silently if it sees a
            // newer gen, preventing stale work from clobbering an active
            // session when start/abort/start happens in rapid succession.
            this._gen = 0;
        }

        start() {
            // Must be non-async: screening_round_room._safeStartRecognition
            // expects a SYNCHRONOUS throw of an InvalidStateError when start
            // is called on a running session. An async function would wrap
            // that throw into a rejected Promise and the existing retry path
            // would silently break.
            if (this._running) {
                const err = new Error('SarvamSTT already running');
                err.name = 'InvalidStateError';
                throw err;
            }
            this._running = true;
            this._endedEmitted = false;
            this._acc = '';
            this._gen++;
            // Async work (mic + WS) runs in the background. Failures route
            // through this.onerror followed by this.onend, matching Web Speech.
            this._startAsync(this._gen);
        }

        async _startAsync(myGen) {
            // Each await point is a yield where a newer start/abort can take
            // over. Check the generation after every await and bail if our
            // session has been superseded.
            //
            // ALL per-session resources live in this local `sess` bag, and the
            // audio pump + WS handlers close over IT, never this._*. That is the
            // fix for the duplication bug: previously _openWs set this._ws and a
            // stale-bail just `return`ed without closing the socket, so the
            // superseding session overwrote this._ws and orphaned the old WS —
            // but its onmessage closure kept writing transcripts into the shared
            // this._acc. Leaked sockets piled up (one per raced restart) and
            // every one of them dumped its transcript into the same accumulator,
            // so each word appeared once per leaked socket ("balancing balancing
            // balancing ...") and old turns' text bled into new ones. Now a
            // superseded session cleans up its OWN sess resources and its
            // handlers are gen-guarded, so it can neither pump audio nor pollute
            // _acc.
            const stale = () => myGen !== this._gen;
            const sess = {
                stream: null, audioCtx: null, sourceNode: null,
                workletNode: null, ws: null,
            };
            const cleanup = () => {
                try { if (sess.ws) sess.ws.close(); } catch (_) {}
                try { if (sess.workletNode) sess.workletNode.disconnect(); } catch (_) {}
                try { if (sess.sourceNode) sess.sourceNode.disconnect(); } catch (_) {}
                try { if (sess.stream) sess.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
                try { if (sess.audioCtx) sess.audioCtx.close(); } catch (_) {}
            };
            try {
                console.log('[SarvamSTT] _startAsync gen=' + myGen + ': opening mic + worklet...');
                await this._openMic(myGen, sess);
                if (stale()) { console.log('[SarvamSTT] gen=' + myGen + ' stale after mic, cleaning up'); cleanup(); return; }
                console.log('[SarvamSTT] gen=' + myGen + ' mic ready, opening WS...');
                await this._openWs(myGen, sess);
                if (stale()) { console.log('[SarvamSTT] gen=' + myGen + ' stale after WS, cleaning up'); cleanup(); return; }
                console.log('[SarvamSTT] gen=' + myGen + ' WS open, upstream live.');
                // Commit this session as the live one. Only now can _teardown()
                // (driven by stop/abort) see and release it.
                this._micStream = sess.stream;
                this._audioCtx = sess.audioCtx;
                this._sourceNode = sess.sourceNode;
                this._workletNode = sess.workletNode;
                this._ws = sess.ws;
                if (typeof this.onstart === 'function') {
                    try { this.onstart(); } catch (_) {}
                }
            } catch (err) {
                cleanup();
                if (stale()) {
                    // A newer session is running; this error belongs to the
                    // old generation and isn't actionable.
                    return;
                }
                console.error('[SarvamSTT] _startAsync gen=' + myGen + ' failed:',
                    err && (err.name || err.type || ''),
                    err && err.message,
                    err);
                this._fireError(err);
                this._teardown();
                this._emitEnd();
            }
        }

        stop() {
            // Graceful: flush a final + close upstream, let onend follow.
            if (!this._running) return;
            this._gen++;   // invalidate any in-flight startup
            try {
                if (this._ws && this._ws.readyState === WebSocket.OPEN) {
                    this._ws.send(JSON.stringify({ action: 'close' }));
                }
            } catch (_) {}
            this._teardown();
            this._emitEnd();
        }

        abort() {
            // Forceful: discard the in-flight utterance. Web Speech
            // distinguishes stop() vs abort(); for our backend they're
            // effectively the same (close upstream + tear down audio).
            if (!this._running) return;
            this._gen++;   // invalidate any in-flight startup
            this._teardown();
            this._emitEnd();
        }

        flush() {
            // Sarvam (Sep 2025) supports a flush signal that finalizes
            // the current segment without closing the session. Useful when
            // the candidate hits Send mid-stream.
            // Drop the in-progress turn locally: the answer was just submitted,
            // so any post-flush transcript must not leak the already-sent text
            // into the next turn.
            this._acc = '';
            try {
                if (this._ws && this._ws.readyState === WebSocket.OPEN) {
                    this._ws.send(JSON.stringify({ action: 'flush' }));
                }
            } catch (_) {}
        }

        // ===== internals =====

        // Build the mic + worklet pipeline into the per-session `sess` bag (never
        // this._*). The audio pump is gen-guarded so a superseded session stops
        // sending frames immediately, and it sends to sess.ws (this session's own
        // socket) rather than the shared this._ws. Throws on real errors; the
        // caller's cleanup() releases sess on stale/throw.
        async _openMic(myGen, sess) {
            const stale = () => myGen !== this._gen;

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });
            sess.stream = stream;
            if (stale()) return;

            // Run the capture AudioContext AT the target rate (16 kHz) so the
            // browser's own high-quality resampler converts the mic stream — far
            // cleaner than our linear worklet downsample, which aliased high
            // frequencies and garbled consonants (hurting recognition accuracy).
            // If the browser ignores the sampleRate hint (e.g. Safari), the
            // worklet's anti-aliased decimator handles the remaining ratio.
            const AC = window.AudioContext || window.webkitAudioContext;
            let audioCtx;
            try {
                audioCtx = new AC({ sampleRate: this.sampleRate });
            } catch (_) {
                audioCtx = new AC();
            }
            sess.audioCtx = audioCtx;
            // AudioWorklet modules are PER-AudioContext, not per-instance, so
            // we always addModule on the freshly-created context. (The browser
            // caches the .js fetch, so this is effectively free after the
            // first call.) The old per-instance _workletLoaded flag was wrong
            // — after teardown closes the context, the next start() creates a
            // new context with no worklet registered, and AudioWorkletNode
            // construction throws InvalidStateError.
            await audioCtx.audioWorklet.addModule('/static/js/pcm_worklet.js');
            if (stale()) return;

            const sourceNode = audioCtx.createMediaStreamSource(stream);
            sess.sourceNode = sourceNode;
            const workletNode = new AudioWorkletNode(
                audioCtx,
                'pcm16-downsampler',
                {
                    processorOptions: {
                        targetRate: this.sampleRate,
                        chunkMs: 200,
                    },
                },
            );
            sess.workletNode = workletNode;
            workletNode.port.onmessage = (e) => {
                // e.data is a transferred Int16Array.buffer.
                // Gen-guard: a superseded session must stop pumping audio so it
                // can't feed duplicate audio into the live upstream. Send to THIS
                // session's socket (sess.ws), never the shared this._ws.
                if (myGen !== this._gen) return;
                // Mic-energy cue: compute the frame RMS (0..1) BEFORE sending, so
                // the room knows the candidate is speaking even while Sarvam's
                // transcript is still catching up. Cheap — sampled, ~16 frames.
                if (typeof this.onaudio === 'function') {
                    try {
                        const pcm = new Int16Array(e.data);
                        const step = Math.max(1, Math.floor(pcm.length / 256));
                        let sumSq = 0, n = 0;
                        for (let i = 0; i < pcm.length; i += step) {
                            const v = pcm[i] / 32768;
                            sumSq += v * v; n++;
                        }
                        this.onaudio(n ? Math.sqrt(sumSq / n) : 0);
                    } catch (_) {}
                }
                if (sess.ws && sess.ws.readyState === WebSocket.OPEN) {
                    try { sess.ws.send(e.data); } catch (_) {}
                }
            };
            sourceNode.connect(workletNode);
            // Workaround: some browsers (Safari) suspend an AudioContext that
            // has no connection to destination. We connect to a muted gain
            // node sink to keep it alive without playing the mic back.
            const mute = audioCtx.createGain();
            mute.gain.value = 0;
            workletNode.connect(mute).connect(audioCtx.destination);
        }

        _openWs(myGen, sess) {
            return new Promise((resolve, reject) => {
                const stale = () => myGen !== this._gen;
                const scheme = (location.protocol === 'https:') ? 'wss:' : 'ws:';
                const params = new URLSearchParams({
                    lang: this.lang || 'en-IN',
                    mode: this.mode || 'codemix',
                    sample_rate: String(this.sampleRate || 16000),
                });
                const url = `${scheme}//${location.host}${STT_ENDPOINT_PATH}?${params}`;
                console.log('[SarvamSTT] WS connect ->', url);
                const ws = new WebSocket(url);
                ws.binaryType = 'arraybuffer';
                sess.ws = ws;

                let openResolved = false;
                ws.onopen = () => {
                    console.log('[SarvamSTT] WS onopen (waiting for {type:open} from server)');
                };
                ws.onmessage = (ev) => {
                    // Gen-guard: ignore everything from a superseded session's
                    // socket. This is what stops a leaked WS from polluting the
                    // live this._acc with duplicate / stale-turn transcripts.
                    if (stale()) return;
                    let msg;
                    try { msg = JSON.parse(ev.data); }
                    catch (_) { return; }
                    if (msg.type === 'open') {
                        if (!openResolved) {
                            openResolved = true;
                            resolve();
                        }
                        return;
                    }
                    if (msg.type === 'error') {
                        // Upstream-level error; surface and tear down.
                        const data = msg.data || {};
                        this._fireError(this._buildErrorEvent(
                            data.code || 'sarvam-error',
                            data.message || 'unknown Sarvam error',
                        ));
                        if (!openResolved) {
                            openResolved = true;
                            reject(new Error(data.message || 'Sarvam error'));
                        }
                        return;
                    }
                    if (msg.type === 'data') {
                        const transcript = (msg.data && msg.data.transcript) || '';
                        if (transcript) {
                            this._acc = this._mergeTranscript(this._acc, transcript);
                            this._emitResult(this._acc, /*isFinal*/ false);
                        }
                        return;
                    }
                    // speech_start / speech_end are VAD hints only — the merge
                    // above already reconstructs the full transcript, so we don't
                    // commit/segment on them.
                    //
                    // DO NOT emit an isFinal result on speech_end and reset _acc:
                    // with high_vad_sensitivity Sarvam fires speech_end on every
                    // short in-utterance pause, and its next window re-transcribes
                    // overlapping audio across that boundary. Committing + wiping
                    // _acc on each speech_end means those repeated words can no
                    // longer be overlap-merged against the already-committed text,
                    // so every word gets appended again and again ("So so so while
                    // while while creating creating ..."). Tried it 2026-06-04,
                    // reverted same day. Tech-vocab corrections still run at send
                    // via _autocorrect, so nothing is actually lost by keeping
                    // everything interim. See [[project_sarvam_stt]] gotcha.
                };
                ws.onerror = (e) => {
                    console.warn('[SarvamSTT] WS onerror', e);
                    if (!openResolved) {
                        openResolved = true;
                        reject(new Error('WebSocket failed to open'));
                    } else if (!stale()) {
                        // Only the live session reports errors to the room.
                        this._fireError(this._buildErrorEvent('network', 'WS error'));
                    }
                };
                ws.onclose = (ev) => {
                    console.warn('[SarvamSTT] WS onclose code=' + (ev && ev.code)
                        + ' reason=' + (ev && ev.reason)
                        + ' wasClean=' + (ev && ev.wasClean));
                    // A superseded session closing is expected cleanup — it must
                    // NOT drive the room's onend (which would rescue stale interim
                    // and trigger a restart). Only the live session ends the room.
                    if (!stale()) this._emitEnd();
                };

                // Hard timeout: if Sarvam doesn't send {type:'open'} within
                // 8s, treat as upstream failure.
                setTimeout(() => {
                    if (!openResolved) {
                        openResolved = true;
                        try { ws.close(); } catch (_) {}
                        reject(new Error('Sarvam STT open timeout'));
                    }
                }, 8000);
            });
        }

        // Overlap-merge `next` into `acc`: find the largest run of words where the
        // tail of `acc` matches the head of `next`, and keep only one copy. Words
        // match case/punctuation-insensitively, and a shorter word that is a prefix
        // of a longer one counts as a match (so a refinement like "Create" ->
        // "creating" is treated as the same word, with the refined form kept).
        // Handles every shape Sarvam emits — cumulative, incremental, sliding
        // window, and refinements — without duplicating or erasing.
        _mergeTranscript(acc, next) {
            const norm = (w) => (w || '').toLowerCase().replace(/[^a-z0-9']/g, '');
            const wordsMatch = (a, b) => {
                const x = norm(a), y = norm(b);
                if (!x || !y) return x === y;
                if (x === y) return true;
                const lo = x.length <= y.length ? x : y;
                const hi = x.length <= y.length ? y : x;
                return lo.length >= 3 && hi.indexOf(lo) === 0;   // refinement / prefix
            };
            const aw = (acc || '').trim() ? acc.trim().split(/\s+/) : [];
            const nw = (next || '').trim() ? next.trim().split(/\s+/) : [];
            if (!aw.length) return nw.join(' ');
            if (!nw.length) return aw.join(' ');
            const maxK = Math.min(aw.length, nw.length, 15);
            let bestK = 0;
            for (let k = maxK; k >= 1; k--) {
                let ok = true;
                for (let i = 0; i < k; i++) {
                    if (!wordsMatch(aw[aw.length - k + i], nw[i])) { ok = false; break; }
                }
                if (ok) { bestK = k; break; }
            }
            // Keep acc's non-overlapping head, then all of next (its overlap words
            // are the refined/punctuated versions, so prefer them).
            return aw.slice(0, aw.length - bestK).concat(nw).join(' ');
        }

        // Defense-in-depth against stutter. The root cause of the bad
        // duplication was leaked sockets all writing to _acc (fixed via the
        // per-session gen-guards), but Sarvam's own codemix partials can still
        // occasionally stutter a word. Collapse any run of the SAME normalized
        // word repeated 3+ times in a row down to a single copy. The 3+ floor
        // leaves genuine doublings ("bye bye", "no no") untouched while killing
        // ASR artifacts ("so so so", "balancing balancing balancing ..."). Runs
        // at emit time only, so it never perturbs the _acc overlap-merge state.
        _collapseRepeats(text) {
            if (!text) return text;
            const norm = (w) => (w || '').toLowerCase().replace(/[^a-z0-9']/g, '');
            const words = text.split(/\s+/);
            const out = [];
            let i = 0;
            while (i < words.length) {
                const key = norm(words[i]);
                let j = i + 1;
                while (j < words.length && key && norm(words[j]) === key) j++;
                if (j - i >= 3 && key) {
                    out.push(words[i]);            // collapse a 3+ run to one
                } else {
                    for (let k = i; k < j; k++) out.push(words[k]);
                }
                i = j;
            }
            return out.join(' ');
        }

        _emitResult(transcript, isFinal) {
            if (typeof this.onresult !== 'function') return;
            const clean = this._collapseRepeats(transcript);
            // Synthesize a SpeechRecognitionEvent-shaped object that
            // screening_round_room.js can iterate identically to Web Speech.
            const result = {
                isFinal: !!isFinal,
                length: 1,
                0: { transcript: clean, confidence: 1.0 },
            };
            const evt = {
                resultIndex: 0,
                results: [result],
            };
            try { this.onresult(evt); } catch (_) {}
        }

        _buildErrorEvent(code, message) {
            // Map Sarvam-side error codes onto the small set of Web Speech
            // error codes that screening_round_room.onerror already handles,
            // so existing branches (network / not-allowed / etc.) still work.
            let mapped = 'network';
            if (code === 'no_api_key' || code === 'service-not-allowed') {
                mapped = 'service-not-allowed';
            } else if (code === 'upstream_open_failed') {
                mapped = 'network';
            } else if (code === 'audio-capture' || code === 'NotAllowedError'
                       || code === 'NotFoundError') {
                mapped = (code === 'NotAllowedError') ? 'not-allowed' : 'audio-capture';
            }
            return { error: mapped, message: message || '' };
        }

        _fireError(errLike) {
            const evt = (errLike && typeof errLike === 'object' && 'error' in errLike)
                ? errLike
                : this._buildErrorEvent(
                    (errLike && errLike.name) || 'network',
                    (errLike && errLike.message) || String(errLike || ''),
                );
            if (typeof this.onerror === 'function') {
                try { this.onerror(evt); } catch (_) {}
            }
        }

        _emitEnd() {
            if (this._endedEmitted) return;
            this._endedEmitted = true;
            this._running = false;
            if (typeof this.onend === 'function') {
                try { this.onend(); } catch (_) {}
            }
        }

        _teardown() {
            this._running = false;
            try { if (this._ws) this._ws.close(); } catch (_) {}
            this._ws = null;
            try { if (this._workletNode) this._workletNode.disconnect(); } catch (_) {}
            this._workletNode = null;
            try { if (this._sourceNode) this._sourceNode.disconnect(); } catch (_) {}
            this._sourceNode = null;
            try {
                if (this._micStream) {
                    this._micStream.getTracks().forEach((t) => t.stop());
                }
            } catch (_) {}
            this._micStream = null;
            try { if (this._audioCtx) this._audioCtx.close(); } catch (_) {}
            this._audioCtx = null;
        }
    }

    // Expose globally so screening_round_room.js can pick it up.
    window.SarvamSpeechRecognition = SarvamSpeechRecognition;
    // Quick capability check for the room init code.
    window.sarvamSttSupported = !!(window.WebSocket
        && window.AudioWorkletNode
        && navigator.mediaDevices
        && navigator.mediaDevices.getUserMedia);
})();
