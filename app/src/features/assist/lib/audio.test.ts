import { describe, expect, it } from "vitest";
import { encodeWav, SpeechDetector } from "./audio";

describe("voice prototype", () => {
  it.each([44100, 48000, 16000])("encodes device sample rate %i to mono PCM 16 kHz", (rate) => {
    const bytes = encodeWav([new Float32Array(rate).fill(0.5)], rate);
    const view = new DataView(bytes.buffer);
    expect(bytes.length).toBe(32044);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getInt16(44, true)).toBe(16383);
  });
  it("keeps long pauses and all spoken sections until explicit finish", () => {
    const detector = new SpeechDetector(16000);
    const voice = new Float32Array(16000).fill(0.2);
    const silence = new Float32Array(16000);
    for (let i = 0; i < 25; i++) expect(detector.push(silence)).toBe("waiting");
    expect(detector.push(voice)).toBe("recording");
    for (let i = 0; i < 10; i++) expect(detector.push(silence)).toBe("recording");
    expect(detector.push(voice)).toBe("recording");
    const wav = detector.finish()!;
    expect(wav.length).toBe(44 + 37 * 16000 * 2);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44 + 25 * 16000 * 2, true)).toBeGreaterThan(0);
    expect(view.getInt16(44 + 36 * 16000 * 2, true)).toBeGreaterThan(0);
  });
  it("does not transcribe silence or a click and bounds recording without discarding prior speech", () => {
    const silence = new SpeechDetector(16000);
    for (let i = 0; i < 10; i++) silence.push(new Float32Array(16000));
    expect(silence.finish()).toBeNull();
    silence.push(new Float32Array(1024).fill(0.5));
    expect(silence.finish()).toBeNull();
    const long = new SpeechDetector(16000);
    for (let i = 0; i < 119; i++)
      expect(long.push(new Float32Array(16000).fill(0.2))).toBe("recording");
    expect(long.push(new Float32Array(32000).fill(0.2))).toBe("too_long");
    expect(long.finish()!.length).toBe(44 + 120 * 16000 * 2);
  });
});
