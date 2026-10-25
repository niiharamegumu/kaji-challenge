import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceSession } from "./VoiceSession";
import type { createCapture } from "../lib/capture";
import type { AssistResult } from "../../../contracts/assist";

const listed: AssistResult = {
  kind: "listed",
  transcript: "やることは？",
  replyText: "ToDoは今ありません。",
  items: [],
  total: 0,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("voice conversation lifecycle", () => {
  let callbacks: Parameters<typeof createCapture>[0];
  let capture: ReturnType<typeof createCapture>;
  const turn = vi.fn(),
    speak = vi.fn();
  let session: VoiceSession;
  beforeEach(() => {
    vi.useFakeTimers();
    turn.mockReset().mockResolvedValue(listed);
    speak.mockReset().mockResolvedValue(undefined);
    capture = {
      ready: Promise.resolve(),
      listen: vi.fn(),
      disable: vi.fn(),
      stop: vi.fn(),
      send: vi.fn(),
    };
    session = new VoiceSession("team", turn, {
      capture: (cb) => {
        callbacks = cb;
        return capture;
      },
      speak,
    });
  });
  afterEach(() => {
    session.close();
    vi.useRealTimers();
  });
  async function start() {
    session.start();
    await vi.advanceTimersByTimeAsync(350);
  }
  it("starts on the gesture, submits once, speaks once, then listens again", async () => {
    await start();
    expect(capture.listen).toHaveBeenCalledTimes(1);
    callbacks.onRecording();
    expect(session.getSnapshot().phase).toBe("recording");
    callbacks.onAudio(new Uint8Array([1, 2]));
    callbacks.onAudio(new Uint8Array([3]));
    await vi.advanceTimersByTimeAsync(350);
    expect(turn).toHaveBeenCalledTimes(1);
    expect(capture.disable).toHaveBeenCalled();
    expect(speak).toHaveBeenLastCalledWith(listed.replyText, expect.any(AbortSignal));
    expect(capture.listen).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().phase).toBe("listening");
  });
  it("does not listen or send during a reply", async () => {
    await start();
    const reply = deferred<void>();
    speak.mockReturnValueOnce(reply.promise);
    callbacks.onAudio(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().phase).toBe("speaking");
    callbacks.onAudio(new Uint8Array([2]));
    await vi.advanceTimersByTimeAsync(1000);
    expect(turn).toHaveBeenCalledTimes(1);
    expect(capture.listen).toHaveBeenCalledTimes(1);
    reply.resolve();
    await vi.advanceTimersByTimeAsync(350);
    expect(capture.listen).toHaveBeenCalledTimes(2);
  });
  it("waits for microphone recovery before showing listening and ignores completion after close", async () => {
    const listening = deferred<void>();
    vi.mocked(capture.listen).mockReturnValue(listening.promise);
    await start();
    expect(session.getSnapshot().phase).toBe("starting");
    callbacks.onAudio(new Uint8Array([1]));
    expect(turn).not.toHaveBeenCalled();
    session.close();
    listening.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({ open: false, phase: "closed" });
  });
  it("shows a recovery failure and stops the microphone without sending a turn", async () => {
    vi.mocked(capture.listen).mockRejectedValue(
      new Error("音声の準備ができません。もう一度開いてください。"),
    );
    await start();
    expect(session.getSnapshot()).toMatchObject({
      phase: "error",
      message: expect.stringContaining("もう一度"),
    });
    expect(capture.stop).toHaveBeenCalled();
    expect(turn).not.toHaveBeenCalled();
  });
  it("stops pending permission preparation and ignores late callbacks after close", async () => {
    const ready = deferred<void>();
    capture.ready = ready.promise;
    session.start();
    session.close();
    ready.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    callbacks.onRecording();
    callbacks.onAudio(new Uint8Array([1]));
    expect(capture.stop).toHaveBeenCalled();
    expect(capture.listen).not.toHaveBeenCalled();
    expect(turn).not.toHaveBeenCalled();
    expect(session.getSnapshot().phase).toBe("closed");
  });
  it("aborts in-flight turns, ignores late success, and never automatically resends", async () => {
    await start();
    const response = deferred<AssistResult>();
    turn.mockReturnValue(response.promise);
    callbacks.onAudio(new Uint8Array([1]));
    const signal = turn.mock.lastCall![1] as AbortSignal;
    session.close();
    expect(signal.aborted).toBe(true);
    expect(session.getSnapshot().message).toContain("追加されている可能性");
    response.resolve(listed);
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot().result).toBeNull();
    expect(session.getSnapshot().phase).toBe("closed");
    expect(turn).toHaveBeenCalledTimes(1);
  });
  it("shows an explicit disabled response and keeps the microphone stopped", async () => {
    await start();
    turn.mockRejectedValue({
      name: "ApiRequestError",
      status: 503,
      code: "assist_disabled",
      message: "音声アシストはまだ有効になっていません。",
    });
    callbacks.onAudio(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().message).toContain("有効になっていません");
    expect(capture.stop).toHaveBeenCalled();
  });
  it("keeps successful results on playback failure without retrying the write", async () => {
    await start();
    speak.mockRejectedValueOnce(new Error("再生できません"));
    callbacks.onAudio(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({
      phase: "error",
      result: listed,
      message: "再生できません",
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(capture.stop).toHaveBeenCalled();
    expect(turn).toHaveBeenCalledTimes(1);
  });
  it("carries only the pending draft and clears it on close", async () => {
    const draft = {
      items: [{ name: "牛乳", categoryName: null }],
      missing: "category" as const,
      expiresAt: Date.now() + 120000,
    };
    turn.mockResolvedValueOnce({
      kind: "clarify",
      transcript: "牛乳を追加して",
      replyText: "どのカテゴリーですか？",
      pendingDraft: draft,
      categories: ["買い物"],
    });
    await start();
    callbacks.onAudio(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(350);
    callbacks.onAudio(new Uint8Array([2]));
    await vi.advanceTimersByTimeAsync(350);
    expect(turn.mock.calls[1][0].pendingDraft).toEqual(draft);
    session.close();
    await start();
    callbacks.onAudio(new Uint8Array([3]));
    await vi.advanceTimersByTimeAsync(0);
    expect(turn.mock.lastCall![0].pendingDraft).toBeUndefined();
  });
  it("ends the mode on idle and ignores callbacks from the ended capture", async () => {
    await start();
    const oldCallbacks = callbacks;
    oldCallbacks.onStop("", "idle");
    expect(session.getSnapshot()).toMatchObject({ open: false, phase: "closed" });
    expect(capture.stop).toHaveBeenCalled();
    await start();
    oldCallbacks.onAudio(new Uint8Array([1]));
    oldCallbacks.onStop("", "idle");
    expect(session.getSnapshot().phase).toBe("listening");
    expect(turn).not.toHaveBeenCalled();
  });
  it("releases the microphone on interruption and requires closing before a new session", async () => {
    await start();
    callbacks.onStop("マイクとの接続が切れました。", "error");
    expect(session.getSnapshot()).toMatchObject({
      phase: "error",
      message: "マイクとの接続が切れました。",
    });
    expect(capture.stop).toHaveBeenCalled();
    session.start();
    expect(session.getSnapshot().phase).toBe("error");
    session.close();
    await start();
    expect(session.getSnapshot()).toMatchObject({ phase: "listening", message: "" });
  });
  it("ends after three minutes even when continuous speech keeps the idle timer active", async () => {
    await start();
    for (let index = 0; index < 5; index++) {
      callbacks.onAudio(new Uint8Array([1]));
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(session.getSnapshot().open).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(session.getSnapshot()).toMatchObject({ open: false, phase: "closed" });
    expect(capture.stop).toHaveBeenCalled();
    callbacks.onAudio(new Uint8Array([2]));
    expect(turn).toHaveBeenCalledTimes(5);
    await start();
    expect(session.getSnapshot().phase).toBe("listening");
  });
  it("aborts an outstanding request at the session deadline and ignores its late result", async () => {
    await start();
    await vi.advanceTimersByTimeAsync(179_000);
    const response = deferred<AssistResult>();
    turn.mockReturnValueOnce(response.promise);
    callbacks.onAudio(new Uint8Array([1]));
    const signal = turn.mock.lastCall![1] as AbortSignal;
    await vi.advanceTimersByTimeAsync(1000);
    expect(signal.aborted).toBe(true);
    expect(session.getSnapshot().message).toContain("追加されている可能性");
    response.resolve(listed);
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot().result).toBeNull();
    expect(turn).toHaveBeenCalledTimes(1);
  });
});
