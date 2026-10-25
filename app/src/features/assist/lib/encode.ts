import type { CapturedAudio } from "./audio";

/** Transfer PCM ownership; terminate on success, failure or cancellation. No main-thread fallback. */
export function encodeAudio(audio: CapturedAudio, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL("./audio-encode.worker.ts", import.meta.url), {
      type: "module",
    });
    let settled = false;
    const finish = (error?: unknown, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (value === undefined) reject(error);
      else resolve(value);
    };
    const abort = () => finish(signal.reason);
    const failure = () =>
      finish(new Error("音声を変換できませんでした。もう一度録音してください。"));
    const timer = setTimeout(failure, 10_000);
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data !== "string" || !event.data) failure();
      else finish(undefined, event.data);
    };
    worker.onerror = failure;
    worker.onmessageerror = failure;
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else {
      try {
        const buffers = [...new Set(audio.chunks.map((chunk) => chunk.buffer as ArrayBuffer))];
        worker.postMessage(audio, buffers);
      } catch (error) {
        finish(error);
      }
    }
  });
}
