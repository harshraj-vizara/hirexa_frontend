/**
 * pcm_worklet.js
 *
 * AudioWorkletProcessor that:
 *   - Reads float32 mono mic input at the AudioContext sample rate
 *     (typically 44100 or 48000 Hz on browser).
 *   - Linearly downsamples to 16000 Hz.
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

        // Linear-resampler state: float index into the input stream
        this.srcPos = 0;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;
        // Mono: use channel 0 (browsers may give multi-channel but mic is mono).
        const channel = input[0];
        if (!channel || channel.length === 0) return true;

        // Linear downsampling: walk the input by `ratio` steps, emit one
        // target sample per step. srcPos can carry across process() calls;
        // we subtract the channel length once we've consumed the buffer.
        while (this.srcPos < channel.length) {
            const i = Math.floor(this.srcPos);
            const frac = this.srcPos - i;
            const s0 = channel[i] || 0;
            const s1 = channel[i + 1] !== undefined ? channel[i + 1] : s0;
            const sample = s0 + (s1 - s0) * frac;

            // float32 -> int16, clamped
            let s = Math.max(-1, Math.min(1, sample));
            this.outBuf[this.outIdx++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

            if (this.outIdx >= this.chunkSamples) {
                // Post a copy so the underlying buffer isn't aliased
                // after we reset outIdx.
                const out = new Int16Array(this.outBuf);
                this.port.postMessage(out.buffer, [out.buffer]);
                this.outIdx = 0;
            }

            this.srcPos += this.ratio;
        }
        // Carry the fractional source position into the next callback.
        this.srcPos -= channel.length;
        return true;
    }
}

registerProcessor('pcm16-downsampler', Pcm16Downsampler);
