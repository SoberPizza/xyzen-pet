class VoicePlaybackWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sourceSampleRate = 24000;
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.idleFrames = 0;
    this.isIdle = true;
    this.underrunPostedAt = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === "clear") {
        this.queue = [];
        this.current = null;
        this.offset = 0;
        this.idleFrames = 0;
        this._setIdle(true);
      } else if (event.data?.type === "config") {
        if (
          typeof event.data.sampleRate === "number" &&
          event.data.sampleRate > 0
        ) {
          this.sourceSampleRate = event.data.sampleRate;
        }
      } else if (event.data?.type === "audio" && event.data.payload) {
        this.queue.push(new Int16Array(event.data.payload));
        this.idleFrames = 0;
        this._setIdle(false);
      }
    };
  }

  _setIdle(nextIdle) {
    if (this.isIdle === nextIdle) return;
    this.isIdle = nextIdle;
    this.port.postMessage({ type: nextIdle ? "idle" : "active" });
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    const sourceStep = this.sourceSampleRate / sampleRate;

    for (let i = 0; i < output.length; i += 1) {
      while (this.current && this.offset >= this.current.length) {
        this.offset -= this.current.length;
        this.current = this.queue.shift() ?? null;
      }

      if (!this.current) {
        this.current = this.queue.shift() ?? null;
        this.offset = 0;
      }

      if (!this.current) {
        output[i] = 0;
        if (!this.isIdle) {
          const now = currentTime;
          if (now - this.underrunPostedAt >= 0.25) {
            this.underrunPostedAt = now;
            this.port.postMessage({ type: "underrun", queued: 0 });
          }
        }
        continue;
      }

      this._setIdle(false);
      const sampleIndex = Math.min(
        Math.floor(this.offset),
        this.current.length - 1,
      );
      output[i] = this.current[sampleIndex] / 0x7fff;
      this.offset += sourceStep;
    }

    if (!this.current && this.queue.length === 0) {
      this.idleFrames += 1;
      if (this.idleFrames >= 8) {
        this._setIdle(true);
      }
    } else {
      this.idleFrames = 0;
    }

    return true;
  }
}

registerProcessor("voice-playback-worklet", VoicePlaybackWorklet);
