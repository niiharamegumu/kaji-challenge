// Runs on the audio thread. Flush the last partial block before stopping dictation.
class AssistCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(1024);
    this.offset = 0;
    this.recording = false;
    this.started = false;
    this.sampleCount = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "start") {
        if (this.recording) return;
        this.offset = 0;
        this.started = false;
        this.sampleCount = 0;
        this.recording = true;
      }
      if (data.type === "cancel") {
        this.recording = false;
        this.offset = 0;
      }
      if (data.type === "finish") {
        this.recording = false;
        if (this.offset) this.port.postMessage(this.samples.slice(0, this.offset));
        this.offset = 0;
        this.port.postMessage({ type: "finished", sampleCount: this.sampleCount });
      }
    };
  }
  process(inputs) {
    if (!this.recording) return true;
    const channels = inputs[0];
    if (!channels?.[0]?.length) return true;
    if (!this.started) {
      this.started = true;
      this.port.postMessage({ type: "started" });
    }
    this.sampleCount += channels[0].length;
    for (let i = 0; i < channels[0].length; i++) {
      this.samples[this.offset++] =
        channels.reduce((sum, channel) => sum + channel[i], 0) / channels.length;
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples, [this.samples.buffer]);
        this.samples = new Float32Array(1024);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("assist-capture", AssistCaptureProcessor);
