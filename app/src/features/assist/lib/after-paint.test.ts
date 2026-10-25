import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { afterPaint } from "./after-paint";

let sequence = 0;
const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  frames.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());
function frame() {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(0));
}
it("waits for a rendering opportunity instead of resolving within the next pre-paint callback", async () => {
  const complete = vi.fn();
  const pending = afterPaint(new AbortController().signal).then(complete);
  frame();
  await Promise.resolve();
  expect(complete).not.toHaveBeenCalled();
  frame();
  await pending;
  expect(complete).toHaveBeenCalledOnce();
});
it.each([0, 1])("cancels remaining frame callbacks when closed after %s frames", async (count) => {
  const controller = new AbortController();
  const pending = afterPaint(controller.signal);
  if (count) frame();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(frames.size).toBe(0);
});
