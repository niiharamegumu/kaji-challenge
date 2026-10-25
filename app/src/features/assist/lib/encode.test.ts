import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeAudio } from "./encode";

class EncoderFixture {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn(() => {
    if (failTransfer) throw new Error("transfer failed");
  });
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
}
const workers: EncoderFixture[] = [];
let failTransfer = false;
const chunk = new Float32Array(1024).fill(0.2);
const audio = { chunks: [chunk, chunk], sampleRate: 48000 };
beforeEach(() => {
  vi.useFakeTimers();
  workers.length = 0;
  failTransfer = false;
  vi.stubGlobal("Worker", EncoderFixture);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("transfers each PCM buffer once and terminates after receiving base64", async () => {
  const result = encodeAudio(audio, new AbortController().signal);
  expect(workers[0].postMessage).toHaveBeenCalledWith(audio, [chunk.buffer]);
  workers[0].onmessage?.({ data: "UklGRg==" });
  await expect(result).resolves.toBe("UklGRg==");
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(workers[0].onmessage).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
it("does not start work after cancellation and terminates an active encoder on close", async () => {
  const controller = new AbortController();
  const pending = encodeAudio(audio, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  await expect(encodeAudio(audio, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(workers).toHaveLength(1);
});
it.each(["error", "messageerror", "invalid", "timeout", "transfer"])(
  "releases the worker on %s without a blocking fallback",
  async (reason) => {
    failTransfer = reason === "transfer";
    const pending = encodeAudio(audio, new AbortController().signal);
    const rejected = expect(pending).rejects.toBeInstanceOf(Error);
    if (reason === "error") workers[0].onerror?.();
    if (reason === "messageerror") workers[0].onmessageerror?.();
    if (reason === "invalid") workers[0].onmessage?.({ data: { text: "wrong type" } });
    if (reason === "timeout") await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  },
);
