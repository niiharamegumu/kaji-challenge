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
describe("review before executing a voice command", () => {
  let callbacks: Parameters<typeof createCapture>[0];
  let capture: ReturnType<typeof createCapture>;
  const transcribe = vi.fn(),
    turn = vi.fn(),
    speak = vi.fn();
  let session: VoiceSession;
  beforeEach(() => {
    vi.useFakeTimers();
    transcribe.mockReset().mockResolvedValue({ transcript: "買い物にナットを追加して" });
    turn.mockReset().mockResolvedValue(listed);
    speak.mockReset().mockResolvedValue(undefined);
    capture = {
      ready: Promise.resolve(),
      listen: vi.fn(),
      disable: vi.fn(),
      stop: vi.fn(),
      send: vi.fn(),
    };
    session = new VoiceSession("team", transcribe, turn, {
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
    await vi.advanceTimersByTimeAsync(0);
  }
  async function record() {
    callbacks.onAudio(new Uint8Array([1, 2]));
    await vi.advanceTimersByTimeAsync(0);
  }
  it("releases the microphone and transcribes once, without interpretation or a write until send", async () => {
    await start();
    expect(speak).not.toHaveBeenCalled();
    callbacks.onRecording();
    expect(session.getSnapshot().phase).toBe("recording");
    callbacks.onAudio(new Uint8Array([1]));
    callbacks.onAudio(new Uint8Array([2]));
    await vi.advanceTimersByTimeAsync(0);
    expect(capture.stop).toHaveBeenCalled();
    expect(transcribe).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({
      phase: "reviewing",
      transcript: "買い物にナットを追加して",
    });
    expect(turn).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(turn).not.toHaveBeenCalled();
    session.editTranscript("買い物に納豆を追加して");
    session.send();
    session.send();
    expect(turn).toHaveBeenCalledExactlyOnceWith(
      { transcript: "買い物に納豆を追加して", expectedTeamId: "team" },
      expect.any(AbortSignal),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().phase).toBe("done");
    expect(speak).toHaveBeenNthCalledWith(1, "確認します。", expect.any(AbortSignal));
    expect(speak).toHaveBeenLastCalledWith(listed.replyText, expect.any(AbortSignal));
    expect(capture.listen).toHaveBeenCalledOnce();
    session.send();
    expect(turn).toHaveBeenCalledOnce();
  });
  it("does not send an empty edit or send before transcription finishes", async () => {
    await start();
    session.send();
    expect(turn).not.toHaveBeenCalled();
    await record();
    session.editTranscript("   ");
    session.send();
    expect(turn).not.toHaveBeenCalled();
    expect(session.getSnapshot().phase).toBe("reviewing");
  });
  it("can close and reopen repeatedly without waiting for a greeting or old callbacks", async () => {
    for (let i = 0; i < 3; i++) {
      await start();
      expect(session.getSnapshot().phase).toBe("listening");
      const old = callbacks;
      await record();
      session.close();
      old.onAudio(new Uint8Array([9]));
      old.onStop("old interruption", "error");
      expect(session.getSnapshot().phase).toBe("closed");
    }
    expect(transcribe).toHaveBeenCalledTimes(3);
    expect(turn).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });
  it("rerecords explicitly and discards the old unsubmitted transcript", async () => {
    await start();
    await record();
    const old = callbacks;
    session.recordAgain();
    await vi.advanceTimersByTimeAsync(0);
    old.onStop("old", "error");
    expect(session.getSnapshot()).toMatchObject({ phase: "listening", transcript: "" });
    expect(turn).not.toHaveBeenCalled();
    transcribe.mockResolvedValueOnce({ transcript: "卵と納豆が必要" });
    await record();
    session.send();
    await vi.advanceTimersByTimeAsync(0);
    expect(turn.mock.lastCall![0].transcript).toBe("卵と納豆が必要");
  });
  it("bounds a stalled second startup and can record again after the failure", async () => {
    await start();
    session.close();
    const ready = deferred<void>();
    capture.ready = ready.promise;
    session.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(session.getSnapshot()).toMatchObject({
      phase: "error",
      message: expect.stringContaining("もう一度"),
    });
    ready.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(capture.listen).toHaveBeenCalledOnce();
    capture.ready = Promise.resolve();
    session.recordAgain();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().phase).toBe("listening");
  });
  it("waits for audio readiness and ignores late preparation after close", async () => {
    const listening = deferred<void>();
    vi.mocked(capture.listen).mockReturnValue(listening.promise);
    await start();
    expect(session.getSnapshot().phase).toBe("starting");
    session.close();
    listening.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().phase).toBe("closed");
    expect(transcribe).not.toHaveBeenCalled();
  });
  it("aborts transcription on close and never shows a late transcript in the new recording", async () => {
    const response = deferred<{ transcript: string }>();
    transcribe.mockReturnValueOnce(response.promise);
    await start();
    callbacks.onAudio(new Uint8Array([1]));
    const signal = transcribe.mock.lastCall![1] as AbortSignal;
    session.close();
    await start();
    response.resolve({ transcript: "古い文字" });
    await vi.advanceTimersByTimeAsync(0);
    expect(signal.aborted).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ phase: "listening", transcript: "" });
    expect(turn).not.toHaveBeenCalled();
  });
  it("aborts submitted work, warns of a possible write, ignores late success and never retries", async () => {
    await start();
    await record();
    const response = deferred<AssistResult>();
    turn.mockReturnValueOnce(response.promise);
    session.send();
    const signal = turn.mock.lastCall![1] as AbortSignal;
    session.close();
    expect(signal.aborted).toBe(true);
    expect(session.getSnapshot().message).toContain("追加されている可能性");
    response.resolve(listed);
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot().result).toBeNull();
    expect(turn).toHaveBeenCalledOnce();
  });
  it("keeps the saved result on playback failure without resending or reopening input", async () => {
    await start();
    await record();
    speak.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("再生できません"));
    session.send();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({
      phase: "error",
      result: listed,
      message: "再生できません",
    });
    session.send();
    await vi.advanceTimersByTimeAsync(1000);
    expect(turn).toHaveBeenCalledOnce();
    expect(capture.listen).toHaveBeenCalledOnce();
  });
  it("carries a clarification across explicit recordings and clears it on close", async () => {
    const draft = {
      items: [{ name: "牛乳", categoryName: null }],
      missing: "category" as const,
      expiresAt: Date.now() + 120000,
    };
    turn.mockResolvedValueOnce({
      kind: "clarify",
      transcript: "牛乳を追加",
      replyText: "どのカテゴリーですか？",
      pendingDraft: draft,
      categories: ["買い物"],
    });
    await start();
    await record();
    session.send();
    await vi.advanceTimersByTimeAsync(0);
    session.recordAgain();
    await vi.advanceTimersByTimeAsync(0);
    await record();
    session.send();
    await vi.advanceTimersByTimeAsync(0);
    expect(turn.mock.calls[1][0].pendingDraft).toEqual(draft);
    session.close();
    await start();
    await record();
    session.send();
    await vi.advanceTimersByTimeAsync(0);
    expect(turn.mock.lastCall![0].pendingDraft).toBeUndefined();
  });
  it("reports microphone failures and ends on idle or the session deadline", async () => {
    await start();
    callbacks.onStop("マイクとの接続が切れました。", "error");
    expect(session.getSnapshot().phase).toBe("error");
    session.recordAgain();
    await vi.advanceTimersByTimeAsync(0);
    callbacks.onStop("", "idle");
    expect(session.getSnapshot().phase).toBe("closed");
    await start();
    await record();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(session.getSnapshot()).toMatchObject({ phase: "closed", transcript: "" });
    expect(turn).not.toHaveBeenCalled();
  });
});
