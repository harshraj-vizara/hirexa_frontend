/**
 * ScreeningRecorder — Automatic interview screen recording
 * Records candidate's screen share + mic audio.
 * Production-grade: auto-recovery, guaranteed upload, retry with backoff.
 */

const ScreeningRecorder = {
    _recording: false,
    _mediaRecorder: null,
    _chunks: [],
    _startTime: 0,
    _uploadPromise: null,
    _screenStream: null,
    _audioStream: null,
    _combinedStream: null,
    _retryBlob: null,       // stashed blob for retry if upload fails
    _retryDuration: 0,
    _trackEndedCleanup: [],  // track event listener removers

    /**
     * Start recording. Called when interview starts on candidate side.
     * @param {MediaStream} screenStream - Candidate's screen share stream
     * @param {MediaStream} audioStream - Candidate's mic audio stream
     * @param {boolean} preserveChunks - Keep existing chunks (rejoin scenario)
     */
    start(screenStream, audioStream, preserveChunks = false) {
        if (this._recording) {
            console.log('[Recorder] Already recording');
            return;
        }

        if (!screenStream || screenStream.getVideoTracks().length === 0) {
            console.warn('[Recorder] No screen stream or no video tracks — cannot record');
            return;
        }

        // Check video tracks are alive
        const videoTrack = screenStream.getVideoTracks()[0];
        if (videoTrack.readyState === 'ended') {
            console.warn('[Recorder] Screen video track is ended — cannot record');
            return;
        }

        try {
            // Store stream references for track recovery
            this._screenStream = screenStream;
            this._audioStream = audioStream;

            // Build combined stream: screen video + mic audio
            const combinedStream = new MediaStream();
            this._combinedStream = combinedStream;

            // Add screen video tracks
            screenStream.getVideoTracks().forEach(track => {
                combinedStream.addTrack(track);
                console.log(`[Recorder] Added video track: ${track.label} (${track.readyState})`);
            });

            // Add mic audio tracks (if available)
            if (audioStream) {
                audioStream.getAudioTracks().forEach(track => {
                    if (track.readyState === 'live') {
                        combinedStream.addTrack(track);
                        console.log(`[Recorder] Added audio track: ${track.label} (${track.readyState})`);
                    }
                });
            }

            // Monitor video track — if screen share ends, stop gracefully (don't lose chunks)
            this._trackEndedCleanup = [];
            const onVideoEnded = () => {
                console.warn('[Recorder] Screen video track ended — stopping recorder gracefully');
                if (this._recording && this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
                    // Request final data before stopping
                    try { this._mediaRecorder.requestData(); } catch (e) {}
                    try { this._mediaRecorder.stop(); } catch (e) {}
                }
                this._recording = false;
            };
            videoTrack.addEventListener('ended', onVideoEnded);
            this._trackEndedCleanup.push(() => videoTrack.removeEventListener('ended', onVideoEnded));

            // Choose best supported format
            const mimeType = this._getBestMimeType();
            console.log(`[Recorder] Using MIME type: ${mimeType}`);

            const recorderOptions = { videoBitsPerSecond: 1500000 };
            if (mimeType) recorderOptions.mimeType = mimeType;

            this._mediaRecorder = new MediaRecorder(combinedStream, recorderOptions);

            if (!preserveChunks) {
                this._chunks = [];
            } else {
                console.log(`[Recorder] Preserving ${this._chunks.length} chunks from before leave`);
            }

            this._mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    this._chunks.push(e.data);
                }
            };

            this._mediaRecorder.onerror = (e) => {
                console.error('[Recorder] MediaRecorder error:', e.error || e);
                // Don't clear chunks on error — they can still be uploaded
                this._recording = false;
            };

            this._mediaRecorder.onstop = () => {
                console.log(`[Recorder] Stopped. Total chunks: ${this._chunks.length}`);
                this._recording = false;
            };

            // Record in 3-second chunks for better reliability (shorter = less data loss)
            this._mediaRecorder.start(3000);
            this._startTime = Date.now();
            this._recording = true;

            console.log(`[Recorder] Recording started successfully`);

        } catch (e) {
            console.error('[Recorder] Failed to start recording:', e);
            this._recording = false;
        }
    },

    /**
     * Stop recording and return the blob.
     * Guarantees chunks are collected even if MediaRecorder is in a bad state.
     * @returns {Promise<{blob: Blob, duration: number}|null>}
     */
    stop() {
        return new Promise((resolve) => {
            const duration = Math.round((Date.now() - this._startTime) / 1000);

            // Clean up track listeners
            this._trackEndedCleanup.forEach(fn => { try { fn(); } catch (e) {} });
            this._trackEndedCleanup = [];

            if (!this._mediaRecorder) {
                // No recorder — check if we have chunks from a previous error/stop
                if (this._chunks.length > 0) {
                    console.log(`[Recorder] No active recorder but ${this._chunks.length} chunks found — building blob`);
                    const blob = new Blob(this._chunks, { type: 'video/webm' });
                    this._chunks = [];
                    resolve({ blob, duration });
                    return;
                }
                console.log('[Recorder] Not recording — nothing to stop');
                resolve(null);
                return;
            }

            console.log(`[Recorder] Stopping... (${duration}s recorded, ${this._chunks.length} chunks so far)`);

            const finalize = () => {
                this._recording = false;
                if (this._chunks.length === 0) {
                    console.warn('[Recorder] No chunks collected — recording may have failed');
                    resolve(null);
                    return;
                }
                const mimeType = this._mediaRecorder?.mimeType || 'video/webm';
                const blob = new Blob(this._chunks, { type: mimeType });
                const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
                console.log(`[Recorder] Final recording: ${sizeMB} MB, ${duration}s`);
                this._chunks = [];
                resolve({ blob, duration });
            };

            // If recorder is already inactive (stopped by track ending), finalize immediately
            if (this._mediaRecorder.state === 'inactive') {
                finalize();
                return;
            }

            // Set onstop to finalize
            this._mediaRecorder.onstop = finalize;

            // Safety timeout — if onstop doesn't fire within 3s, force finalize
            const safetyTimeout = setTimeout(() => {
                console.warn('[Recorder] onstop did not fire within 3s — force finalizing');
                finalize();
            }, 3000);

            const originalOnStop = this._mediaRecorder.onstop;
            this._mediaRecorder.onstop = () => {
                clearTimeout(safetyTimeout);
                originalOnStop();
            };

            try {
                // Request any remaining data before stopping
                try { this._mediaRecorder.requestData(); } catch (e) {}
                this._mediaRecorder.stop();
            } catch (e) {
                console.warn('[Recorder] Stop error:', e);
                clearTimeout(safetyTimeout);
                finalize();
            }
        });
    },

    /**
     * Upload recording blob to backend with exponential backoff retry.
     * @param {string} roomId
     * @param {Blob} blob
     * @param {number} duration - seconds
     * @param {number} maxRetries - max retry attempts
     * @returns {Promise<object|null>} - { success, view_link, download_link }
     */
    async upload(roomId, blob, duration, maxRetries = 3) {
        if (!blob || blob.size === 0) {
            console.warn('[Recorder] No recording data to upload');
            return null;
        }

        const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
        console.log(`[Recorder] Uploading ${sizeMB} MB for room ${roomId}...`);

        // Stash blob for potential retry from outside
        this._retryBlob = blob;
        this._retryDuration = duration;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const formData = new FormData();
                formData.append('file', blob, `recording_${roomId}.webm`);
                formData.append('duration', duration.toString());

                const controller = new AbortController();
                // 5 minute timeout for upload (large files on slow connections)
                const timeoutId = setTimeout(() => controller.abort(), 300000);

                const res = await fetch(`${window.location.origin}/api/screening_recording/upload/${roomId}`, {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!res.ok) {
                    const err = await res.text();
                    console.error(`[Recorder] Upload failed (attempt ${attempt + 1}/${maxRetries + 1}):`, res.status, err);
                    if (attempt < maxRetries) {
                        const delay = Math.min((attempt + 1) * 3000, 15000);
                        console.log(`[Recorder] Retrying in ${delay / 1000}s...`);
                        await new Promise(r => setTimeout(r, delay));
                        continue;
                    }
                    return null;
                }

                const result = await res.json();
                console.log(`[Recorder] Upload complete: ${result.view_link}`);
                this._retryBlob = null;
                return result;

            } catch (e) {
                if (e.name === 'AbortError') {
                    console.error(`[Recorder] Upload timed out (attempt ${attempt + 1})`);
                } else {
                    console.error(`[Recorder] Upload error (attempt ${attempt + 1}):`, e);
                }
                if (attempt < maxRetries) {
                    const delay = Math.min((attempt + 1) * 3000, 15000);
                    console.log(`[Recorder] Retrying in ${delay / 1000}s...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                return null;
            }
        }
        return null;
    },

    /**
     * Stop recording and upload in one call. Stores the upload promise
     * so callers can await it (e.g., before page redirect).
     */
    async stopAndUpload(roomId) {
        const result = await this.stop();
        if (result && result.blob) {
            this._uploadPromise = this.upload(roomId, result.blob, result.duration);
            return this._uploadPromise;
        }
        // Even if stop returned null, check if we have chunks that weren't captured
        if (this._chunks.length > 0) {
            const blob = new Blob(this._chunks, { type: 'video/webm' });
            const duration = Math.round((Date.now() - this._startTime) / 1000);
            this._chunks = [];
            if (blob.size > 0) {
                console.log(`[Recorder] Recovered ${(blob.size / 1024 / 1024).toFixed(1)} MB from remaining chunks`);
                this._uploadPromise = this.upload(roomId, blob, duration);
                return this._uploadPromise;
            }
        }
        return null;
    },

    /**
     * Retry the last failed upload (uses stashed blob).
     */
    async retryUpload(roomId) {
        if (this._retryBlob) {
            console.log('[Recorder] Retrying upload with stashed blob...');
            return this.upload(roomId, this._retryBlob, this._retryDuration);
        }
        return null;
    },

    /**
     * Get the best supported video MIME type.
     */
    _getBestMimeType() {
        const types = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
            // Safari fallback (Safari doesn't support WebM recording)
            'video/mp4;codecs=h264,aac',
            'video/mp4',
        ];

        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }
        return '';  // Let browser pick default
    },

    isRecording() {
        return this._recording;
    },

    /**
     * Check if there are any chunks collected (even if recorder errored out).
     */
    hasData() {
        return this._chunks.length > 0 || this._retryBlob !== null;
    },

    /**
     * Check if there's a pending upload.
     */
    isUploading() {
        return this._uploadPromise !== null;
    },

    /**
     * Wait for any pending upload to finish.
     */
    async waitForUpload() {
        if (this._uploadPromise) {
            const result = await this._uploadPromise;
            this._uploadPromise = null;
            return result;
        }
        return null;
    }
};
