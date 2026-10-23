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
  it("keeps pre-roll and completes only after speech and trailing silence", () => {
    const detector = new SpeechDetector(16000);
    const silence = new Float32Array(1600),
      voice = new Float32Array(1600).fill(0.2);
    for (let i = 0; i < 5; i++) expect(detector.push(silence)).toBe("waiting");
    expect(detector.push(voice)).toBe("recording");
    detector.push(voice);
    detector.push(voice);
    for (let i = 0; i < 10; i++) expect(detector.push(silence)).toBe("recording");
    expect(detector.push(silence)).toBe("ready");
    expect(detector.finish()!.length).toBeGreaterThan(16000 * 1.4 * 2);
  });
  it("does not submit silence or a brief click and refuses truncated long speech", () => {
    const detector = new SpeechDetector(16000);
    detector.push(new Float32Array(1024).fill(0.5));
    for (let i = 0; i < 21; i++) detector.push(new Float32Array(16000));
    expect(detector.finish()).toBeNull();
    const long = new SpeechDetector(16000);
    for (let i = 0; i < 14; i++)
      expect(long.push(new Float32Array(16000).fill(0.2))).toBe("recording");
    expect(long.push(new Float32Array(16000).fill(0.2))).toBe("too_long");
  });
});
