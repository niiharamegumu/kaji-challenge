/** Give the pending UI a rendering opportunity before starting more work. */
export function afterPaint(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let frame: number;
    const abort = () => {
      cancelAnimationFrame(frame);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    // rAF runs before paint; a second frame lets the browser render the first one.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      });
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
