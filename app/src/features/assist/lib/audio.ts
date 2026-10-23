import { assistAudio } from "../../../contracts/assist";

/** Average source samples into 16 kHz frames; use the actual device sample rate. */
export function encodeWav(chunks: Float32Array[], sampleRate: number): Uint8Array<ArrayBuffer> {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  const length = Math.floor((size * assistAudio.sampleRate) / sampleRate);
  const bytes = new Uint8Array(44 + length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) =>
    [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, assistAudio.sampleRate, true);
  view.setUint32(28, assistAudio.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, length * 2, true);
  const ratio = sampleRate / assistAudio.sampleRate;
  for (let i = 0; i < length; i++) {
    const start = i * ratio,
      end = (i + 1) * ratio;
    let sum = 0;
    for (let j = Math.floor(start); j < Math.ceil(end); j++) {
      sum += (samples[j] ?? 0) * (Math.min(end, j + 1) - Math.max(start, j));
    }
    const value = Math.max(-1, Math.min(1, sum / ratio));
    view.setInt16(44 + i * 2, value * (value < 0 ? 32768 : 32767), true);
  }
  return bytes;
}

export function wavBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export class SpeechDetector {
  private chunks: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private elapsed = 0;
  private duration = 0;
  private silence = 0;
  private voiced = 0;
  private noise = 0.001;
  recording = false;
  constructor(private sampleRate: number) {}
  push(samples: Float32Array): "waiting" | "recording" | "ready" | "idle" | "too_long" {
    const seconds = samples.length / this.sampleRate;
    this.elapsed += seconds;
    const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
    const speech = rms > Math.max(0.008, this.noise * 3);
    if (!this.recording) {
      this.preRoll.push(samples);
      while (
        this.preRoll.length > 1 &&
        this.preRoll.reduce((sum, x) => sum + x.length, 0) > this.sampleRate * 0.2
      )
        this.preRoll.shift();
      if (!speech) {
        this.noise = Math.min(0.015, this.noise * 0.95 + rms * 0.05);
        return this.elapsed >= 20 ? "idle" : "waiting";
      }
      this.recording = true;
      this.chunks = this.preRoll;
      this.preRoll = [];
      this.duration = this.chunks.reduce((sum, x) => sum + x.length, 0) / this.sampleRate;
    } else {
      this.chunks.push(samples);
      this.duration += seconds;
    }
    this.silence = speech ? 0 : this.silence + seconds;
    if (speech) this.voiced += seconds;
    if (this.duration >= assistAudio.maxSeconds) return "too_long";
    if (this.silence >= 1) {
      if (this.voiced >= 0.18) return "ready";
      this.recording = false;
      this.chunks = [];
      this.duration = 0;
      this.voiced = 0;
    }
    return this.recording ? "recording" : "waiting";
  }
  finish() {
    return this.voiced >= 0.18 ? encodeWav(this.chunks, this.sampleRate) : null;
  }
}
