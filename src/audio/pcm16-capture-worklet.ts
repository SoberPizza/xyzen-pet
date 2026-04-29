/// <reference types="@types/audioworklet" />

/**
 * PCM16 capture worklet.
 *
 * Runs on the AudioWorklet render thread. Receives whatever sample rate
 * the AudioContext is running at, downmixes to mono, linearly resamples
 * to TARGET_RATE (16 kHz), and emits frames of FRAME_SAMPLES samples
 * (640 bytes Int16 = 20 ms at 16 kHz) back to the main thread.
 *
 * Each message carries two views into the same buffer:
 *   - `pcm16`  — Int16Array transferable to the server
 *   - `float`  — Float32Array for client-side VAD
 */

const TARGET_RATE = 16_000
const FRAME_SAMPLES = 320 // 20 ms @ 16 kHz

class Pcm16CaptureProcessor extends AudioWorkletProcessor {
  private readonly _resampleRatio: number
  private _resampleCursor = 0
  private _resampleLast = 0
  private readonly _frameBuffer = new Float32Array(FRAME_SAMPLES)
  private _frameFill = 0

  constructor() {
    super()
    this._resampleRatio = sampleRate / TARGET_RATE
  }

  private _downmix(input: Float32Array[] | undefined): Float32Array | null {
    if (!input || input.length === 0) return null
    if (input.length === 1) return input[0]
    const mono = new Float32Array(input[0].length)
    const channels = input.length
    for (let ch = 0; ch < channels; ch++) {
      const data = input[ch]
      for (let i = 0; i < data.length; i++) mono[i] += data[i]
    }
    const inv = 1 / channels
    for (let i = 0; i < mono.length; i++) mono[i] *= inv
    return mono
  }

  private _pushSample(sample: number): void {
    this._frameBuffer[this._frameFill++] = sample
    if (this._frameFill >= FRAME_SAMPLES) {
      this._emitFrame()
      this._frameFill = 0
    }
  }

  private _emitFrame(): void {
    const floatOut = new Float32Array(FRAME_SAMPLES)
    floatOut.set(this._frameBuffer)
    const pcmOut = new Int16Array(FRAME_SAMPLES)
    for (let i = 0; i < FRAME_SAMPLES; i++) {
      let s = floatOut[i]
      if (s > 1) s = 1
      else if (s < -1) s = -1
      pcmOut[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }
    this.port.postMessage(
      { pcm16: pcmOut.buffer, float: floatOut.buffer },
      [pcmOut.buffer, floatOut.buffer],
    )
  }

  process(inputs: Float32Array[][]): boolean {
    const mono = this._downmix(inputs[0])
    if (!mono) return true

    const ratio = this._resampleRatio
    if (Math.abs(ratio - 1) < 1e-6) {
      for (let i = 0; i < mono.length; i++) this._pushSample(mono[i])
      return true
    }

    // Linear resample by walking the output clock at `_resampleCursor`
    // and interpolating between the previous emitted input sample and
    // the current input block.
    let prev = this._resampleLast
    let cursor = this._resampleCursor
    for (let i = 0; i < mono.length; i++) {
      const cur = mono[i]
      while (cursor < 1) {
        this._pushSample(prev * (1 - cursor) + cur * cursor)
        cursor += ratio
      }
      cursor -= 1
      prev = cur
    }
    this._resampleLast = prev
    this._resampleCursor = cursor
    return true
  }
}

registerProcessor('pcm16-capture', Pcm16CaptureProcessor)
