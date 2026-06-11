/**
 * pcm_worklet.js
 *
 * AudioWorkletProcessor that:
 *   - Reads float32 mono mic input at the AudioContext sample rate
 *     (16000 Hz when the context honors the rate hint, else 44100/48000).
 *   - Downsamples to 16000 Hz with a box-average (anti-aliasing) decimator —
 *     averaging the input samples that fall in each output window acts as a
 *     low-pass filter, so high-frequency consonants don't alias into garbage.
 *     When the context already runs at 16k the ratio is 1 (pass-through).
 *   - Converts float32 [-1, 1] -> int16 little-endian PCM.
 *   - Posts ArrayBuffer chunks (~200 ms each) to the main thread.
 *
 * Loaded via:
 *     audioCtx.audioWorklet.addModule('/static/js/pcm_worklet.js')
 * then:
 *     new AudioWorkletNode(audioCtx, 'pcm16-downsampler',
 *         { processorOptions: { targetRate: 16000, chunkMs: 200 } })
 */

class Pcm16Downsampler extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const opts = (options && options.processorOptions) || {};
        this.targetRate = opts.targetRate || 16000;
        this.chunkMs = opts.chunkMs || 200;
        // sampleRate is a global AudioWorklet variable = AudioContext rate
        this.inputRate = sampleRate;
        this.ratio = this.inputRate / this.targetRate;

        // Output chunk size in target samples (e.g. 200ms * 16k = 3200 samples)
        this.chunkSamples = Math.round((this.chunkMs / 1000) * this.targetRate);
        this.outBuf = new Int16Array(this.chunkSamples);
        this.outIdx = 0;

        // Box-average decimator state. We count input samples (this.pos) and emit
        // one output sample at each window boundary (this.next, stepping by ratio),
        // emitting the AVERAGE of the input samples in that window. Averaging is a
        // cheap low-pass that prevents aliasing when downsampling.
        this.pos = 0;            // input-sample counter (carries across callbacks)
        this.next = this.ratio;  // next output-window boundary, in input samples
        this.acc = 0;            // sum of input samples in the current window
        this.accN = 0;           // count of input samples in the current window
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;
        // Mono: use channel 0 (browsers may give multi-channel but mic is mono).
        const channel = input[0];
        if (!channel || channel.length === 0) return true;

        const len = channel.length;
        for (let i = 0; i < len; i++) {
            this.acc += channel[i];
            this.accN++;
            this.pos++;

            if (this.pos >= this.next) {
                // Emit the window average (low-passed sample), float32 -> int16.
                const avg = this.accN ? this.acc / this.accN : 0;
                const s = Math.max(-1, Math.min(1, avg));
                this.outBuf[this.outIdx++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

                if (this.outIdx >= this.chunkSamples) {
                    // Post a copy so the underlying buffer isn't aliased
                    // after we reset outIdx.
                    const out = new Int16Array(this.outBuf);
                    this.port.postMessage(out.buffer, [out.buffer]);
                    this.outIdx = 0;
                }

                this.acc = 0;
                this.accN = 0;
                this.next += this.ratio;
            }
        }
        // Keep the counters bounded: shift both back by the buffer we just
        // consumed (their difference — i.e. window phase — is preserved).
        this.pos -= len;
        this.next -= len;
        return true;
    }
}

registerProcessor('pcm16-downsampler', Pcm16Downsampler);
