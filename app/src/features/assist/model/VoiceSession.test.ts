import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceSession } from "./VoiceSession";
import type { createCapture } from "../lib/capture";
import type { AssistResult } from "../../../contracts/assist";
const audio = { chunks: [new Float32Array([0.2, 0.2])], sampleRate: 16000 };
const wav = new Blob([new Uint8Array(3244)], { type: "audio/wav" });
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
describe("explicit dictation and submission", () => {
  let callbacks: Parameters<typeof createCapture>[0];
  let capture: ReturnType<typeof createCapture>;
  const transcribe = vi.fn(),
    turn = vi.fn(),
    create = vi.fn(),
    encode = vi.fn();
  let session: VoiceSession;
  beforeEach(() => {
    vi.useFakeTimers();
    transcribe.mockReset().mockResolvedValue({ transcript: "納豆を追加して" });
    turn.mockReset().mockResolvedValue(listed);
    encode.mockReset().mockResolvedValue(wav);
    capture = {
      ready: Promise.resolve(),
      listen: vi.fn(),
      disable: vi.fn(),
      stop: vi.fn(),
      send: vi.fn(async () => {
        callbacks.onAudio(audio);
      }),
    };
    create.mockReset().mockImplementation((cb) => {
      callbacks = cb;
      return capture;
    });
    session = new VoiceSession("team", transcribe, turn, { capture: create, encode });
  });
  afterEach(() => {
    session.close();
    vi.useRealTimers();
  });
  const tick = () => vi.advanceTimersByTimeAsync(0);
  async function record() {
    session.start();
    session.startRecording();
    await tick();
  }
  it("opens without a microphone request and permits typed text to be sent", async () => {
    session.start();
    session.start();
    await tick();
    expect(session.getSnapshot().phase).toBe("idle");
    expect(create).not.toHaveBeenCalled();
    session.editTranscript("買い物に卵を追加して");
    session.send();
    session.send();
    expect(session.getSnapshot().phase).toBe("processing");
    expect(turn).toHaveBeenCalledOnce();
    await tick();
    expect(turn).toHaveBeenCalledExactlyOnceWith(
      { transcript: "買い物に卵を追加して", expectedTeamId: "team" },
      expect.any(AbortSignal),
    );
    expect(transcribe).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({
      phase: "done",
      transcript: "",
      submittedTranscript: "買い物に卵を追加して",
      result: listed,
    });
  });
  it("only transcribes after an explicit stop, appends to the draft and waits for send", async () => {
    session.start();
    session.editTranscript("買い物に");
    session.startRecording();
    await tick();
    callbacks.onRecording();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(transcribe).not.toHaveBeenCalled();
    expect(turn).not.toHaveBeenCalled();
    session.stopRecording();
    await tick();
    expect(capture.send).toHaveBeenCalledOnce();
    expect(capture.stop).toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({
      phase: "reviewing",
      transcript: "買い物に\n納豆を追加して",
    });
    expect(turn).not.toHaveBeenCalled();
    session.editTranscript("買い物に納豆と卵を追加して");
    session.send();
    session.send();
    await tick();
    expect(turn).toHaveBeenCalledOnce();
    expect(turn.mock.lastCall![0].transcript).toBe("買い物に納豆と卵を追加して");
  });
  it("stop-and-send waits for transcription then submits exactly once without a review transition", async () => {
    const response = deferred<{ transcript: string }>();
    transcribe.mockReturnValueOnce(response.promise);
    const phases: string[] = [];
    session.subscribe(() => phases.push(session.getSnapshot().phase));
    await record();
    session.stopRecording(true);
    session.stopRecording();
    session.send();
    expect(turn).not.toHaveBeenCalled();
    expect(session.getSnapshot().phase).toBe("submitting");
    response.resolve({ transcript: "納豆と卵を追加して" });
    await tick();
    expect(turn).toHaveBeenCalledExactlyOnceWith(
      { transcript: "納豆と卵を追加して", expectedTeamId: "team" },
      expect.any(AbortSignal),
    );
    expect(transcribe).toHaveBeenCalledExactlyOnceWith(
      { audio: wav, expectedTeamId: "team" },
      expect.any(AbortSignal),
    );
    expect(phases).not.toContain("reviewing");
    expect(session.getSnapshot().phase).toBe("done");
  });
  it("starts background encoding immediately and ignores completion after closing", async () => {
    const encoded = deferred<Blob>();
    encode.mockReturnValueOnce(encoded.promise);
    await record();
    session.stopRecording(true);
    expect(session.getSnapshot().phase).toBe("submitting");
    expect(encode).toHaveBeenCalledOnce();
    expect(capture.stop).toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    const signal = encode.mock.lastCall![1] as AbortSignal;
    session.close();
    expect(signal.aborted).toBe(true);
    encoded.resolve(wav);
    await tick();
    expect(transcribe).not.toHaveBeenCalled();
    expect(turn).not.toHaveBeenCalled();
  });
  it("acknowledges stop-and-send before audio flush and discards the previous answer", async () => {
    session.start();
    session.editTranscript("前の指示");
    session.send();
    await tick();
    session.editTranscript("続きの下書き");
    session.startRecording();
    await tick();
    vi.mocked(capture.send).mockResolvedValue(undefined);
    session.stopRecording(true);
    session.stopRecording(true);
    expect(session.getSnapshot()).toMatchObject({
      phase: "submitting",
      transcript: "続きの下書き",
      submittedTranscript: "",
      result: null,
    });
    expect(capture.send).toHaveBeenCalledOnce();
    expect(transcribe).not.toHaveBeenCalled();
    expect(turn).toHaveBeenCalledOnce();
    session.close();
    callbacks.onAudio(audio);
    await tick();
    expect(transcribe).not.toHaveBeenCalled();
    expect(turn).toHaveBeenCalledOnce();
  });
  it("does not auto-submit a duration-limited recording, even if it races with stop-and-send", async () => {
    vi.mocked(capture.send).mockResolvedValue(undefined);
    await record();
    session.stopRecording(true);
    callbacks.onAudio(audio, true);
    await tick();
    expect(session.getSnapshot()).toMatchObject({
      phase: "reviewing",
      transcript: "納豆を追加して",
      message: expect.stringContaining("2分"),
    });
    expect(turn).not.toHaveBeenCalled();
  });
  it("retains an over-limit combined draft and requires editing before any submission", async () => {
    session.start();
    session.editTranscript("あ".repeat(2000));
    session.startRecording();
    await tick();
    session.stopRecording(true);
    await tick();
    expect(session.getSnapshot().transcript.length).toBeGreaterThan(2000);
    expect(session.getSnapshot().message).toContain("2000文字");
    expect(turn).not.toHaveBeenCalled();
    session.editTranscript("納豆");
    session.send();
    await tick();
    expect(turn).toHaveBeenCalledOnce();
  });
  it("does not send empty input or accept input while recording", async () => {
    session.start();
    session.editTranscript("   ");
    session.send();
    expect(turn).not.toHaveBeenCalled();
    await record();
    session.editTranscript("unexpected");
    session.send();
    expect(turn).not.toHaveBeenCalled();
    expect(session.getSnapshot().transcript).toBe("   ");
  });
  it("ignores an old transcription and its send intent after close and reopen", async () => {
    const response = deferred<{ transcript: string }>();
    transcribe.mockReturnValueOnce(response.promise);
    await record();
    session.stopRecording(true);
    await tick();
    const signal = transcribe.mock.lastCall![1] as AbortSignal;
    session.close();
    session.start();
    response.resolve({ transcript: "古い文字" });
    await tick();
    expect(signal.aborted).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ phase: "idle", transcript: "" });
    expect(turn).not.toHaveBeenCalled();
    session.startRecording();
    await tick();
    session.stopRecording();
    await tick();
    expect(turn).not.toHaveBeenCalled();
  });
  it("keeps typed input on recognition failure and can start another recording", async () => {
    session.start();
    session.editTranscript("残す文字");
    transcribe.mockRejectedValueOnce(new Error("ASR failed"));
    session.startRecording();
    await tick();
    session.stopRecording(true);
    await tick();
    expect(session.getSnapshot()).toMatchObject({ phase: "error", transcript: "残す文字" });
    expect(turn).not.toHaveBeenCalled();
    session.startRecording();
    await tick();
    expect(session.getSnapshot().phase).toBe("listening");
  });
  it("bounds a stalled startup and ignores the late readiness result", async () => {
    const ready = deferred<void>();
    capture.ready = ready.promise;
    await record();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(session.getSnapshot().phase).toBe("error");
    ready.resolve();
    await tick();
    expect(capture.listen).not.toHaveBeenCalled();
    capture.ready = Promise.resolve();
    session.startRecording();
    await tick();
    expect(session.getSnapshot().phase).toBe("listening");
  });
  it("can close and reopen repeatedly and ignores callbacks from the last capture", async () => {
    for (let i = 0; i < 3; i++) {
      await record();
      const old = callbacks;
      session.stopRecording();
      await tick();
      session.close();
      session.start();
      old.onAudio(audio);
      old.onStop("old", "error");
      expect(session.getSnapshot().phase).toBe("idle");
    }
    expect(transcribe).toHaveBeenCalledTimes(3);
    expect(turn).not.toHaveBeenCalled();
  });
  it("aborts submitted work, warns about a possible write and never automatically retries", async () => {
    const response = deferred<AssistResult>();
    turn.mockReturnValueOnce(response.promise);
    session.start();
    session.editTranscript("卵を追加");
    session.send();
    await tick();
    const signal = turn.mock.lastCall![1] as AbortSignal;
    session.close();
    expect(signal.aborted).toBe(true);
    expect(session.getSnapshot().message).toContain("操作が反映されている可能性");
    response.resolve(listed);
    await tick();
    expect(session.getSnapshot().result).toBeNull();
    expect(turn).toHaveBeenCalledOnce();
  });
  it("carries clarification into the next explicit input and discards it on close", async () => {
    const draft = {
      items: [{ name: "牛乳", categoryName: null }],
      missing: "category" as const,
      expiresAt: Date.now() + 120000,
    };
    turn.mockResolvedValueOnce({
      kind: "clarify",
      transcript: "牛乳",
      replyText: "どのカテゴリーですか？",
      pendingDraft: draft,
      categories: ["買い物"],
    });
    session.start();
    session.editTranscript("牛乳");
    session.send();
    await tick();
    session.editTranscript("買い物");
    session.send();
    await tick();
    expect(turn.mock.calls[1][0].pendingDraft).toEqual(draft);
    session.close();
    session.start();
    session.editTranscript("卵");
    session.send();
    await tick();
    expect(turn.mock.lastCall![0].pendingDraft).toBeUndefined();
  });
});
