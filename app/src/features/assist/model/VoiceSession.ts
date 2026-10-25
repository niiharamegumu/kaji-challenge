import type {
  AssistAudioRequest,
  AssistDraft,
  AssistRequest,
  AssistResult,
} from "../../../contracts/assist";
import { isApiRequestError } from "../../../lib/api/api-client-state";
import { createCapture } from "../lib/capture";
import { wavBase64 } from "../lib/audio";
import { speakReply } from "../lib/speech";

export type VoiceState = {
  open: boolean;
  phase:
    | "closed"
    | "starting"
    | "listening"
    | "recording"
    | "transcribing"
    | "reviewing"
    | "processing"
    | "speaking"
    | "done"
    | "error";
  transcript: string;
  result: AssistResult | null;
  message: string;
};
type Dependencies = { capture: typeof createCapture; speak: typeof speakReply };
const interrupted =
  "処理を中断しました。追加されている可能性があります。ToDo一覧を確認してください。";

/** Recording and transcription never execute a command. Only send() can do that. */
export class VoiceSession {
  private state: VoiceState = {
    open: false,
    phase: "closed",
    transcript: "",
    result: null,
    message: "",
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller = new AbortController();
  private capture?: ReturnType<typeof createCapture>;
  private pending?: AssistDraft;
  private sessionTimer?: ReturnType<typeof setTimeout>;
  private startupTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private teamId: string,
    private transcribe: (
      input: AssistAudioRequest,
      signal: AbortSignal,
    ) => Promise<{ transcript: string }>,
    private turn: (input: AssistRequest, signal: AbortSignal) => Promise<AssistResult>,
    private dependencies: Dependencies = { capture: createCapture, speak: speakReply },
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(update: Partial<VoiceState>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach((listener) => listener());
  }
  private stopCapture() {
    clearTimeout(this.startupTimer);
    this.capture?.stop();
    this.capture = undefined;
  }
  private release() {
    this.generation++;
    this.controller.abort();
    clearTimeout(this.sessionTimer);
    this.stopCapture();
    this.controller = new AbortController();
  }
  close = () => {
    if (!this.state.open) return;
    const processing = this.state.phase === "processing";
    this.release();
    this.pending = undefined;
    this.update({
      open: false,
      phase: "closed",
      transcript: "",
      result: null,
      message: processing ? interrupted : "",
    });
  };
  private fail(message: string) {
    this.release();
    this.pending = undefined;
    this.update({ phase: "error", message });
  }
  start = () => {
    if (!this.state.open) this.beginRecording();
  };
  recordAgain = () => {
    if (this.state.open && ["reviewing", "done", "error"].includes(this.state.phase))
      this.beginRecording();
  };
  private beginRecording() {
    this.release();
    const generation = this.generation;
    this.update({ open: true, phase: "starting", transcript: "", result: null, message: "" });
    this.sessionTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      const processing = this.state.phase === "processing";
      this.close();
      if (!processing)
        this.update({
          message: "音声アシストを終了しました。続けるときはもう一度開いてください。",
        });
    }, 180_000);
    // Include every startup await, even a browser API that never settles.
    this.startupTimer = setTimeout(() => {
      if (generation === this.generation)
        this.fail("マイクを準備できませんでした。もう一度録音してください。");
    }, 30_000);
    try {
      // No greeting or playback competes with microphone initialization.
      this.capture = this.dependencies.capture({
        onRecording: () => {
          if (generation === this.generation && this.state.phase === "listening")
            this.update({ phase: "recording" });
        },
        onAudio: (wav) => {
          if (generation === this.generation) void this.reviewAudio(wav, generation);
        },
        onStop: (message, reason) => {
          if (generation !== this.generation) return;
          if (reason === "idle") this.close();
          else this.fail(message);
        },
      });
      const capture = this.capture;
      void capture.ready
        .then(async () => {
          if (generation !== this.generation) return;
          await capture.listen();
          if (generation !== this.generation) return;
          clearTimeout(this.startupTimer);
          this.update({ phase: "listening", message: "" });
        })
        .catch((error: unknown) => {
          if (generation !== this.generation) return;
          this.fail(
            error instanceof Error && error.name === "NotAllowedError"
              ? "マイクが許可されていません。端末・ブラウザーのマイク設定を確認してください。"
              : error instanceof Error
                ? error.message
                : "録音を開始できませんでした。",
          );
        });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "録音を開始できませんでした。");
    }
  }
  private async reviewAudio(wav: Uint8Array<ArrayBuffer>, generation: number) {
    if (!["listening", "recording"].includes(this.state.phase)) return;
    // Release the input before ASR, review or any speech playback.
    this.stopCapture();
    this.update({ phase: "transcribing", message: "" });
    try {
      const result = await this.transcribe(
        { audioBase64: wavBase64(wav), expectedTeamId: this.teamId },
        this.controller.signal,
      );
      if (generation === this.generation)
        this.update({ phase: "reviewing", transcript: result.transcript });
    } catch (error) {
      if (generation === this.generation)
        this.fail(
          isApiRequestError(error)
            ? error.message
            : "文字にできませんでした。もう一度録音してください。",
        );
    }
  }
  editTranscript = (transcript: string) => {
    if (this.state.phase === "reviewing") this.update({ transcript });
  };
  send = () => {
    if (this.state.phase !== "reviewing" || !this.state.transcript.trim()) return;
    const generation = this.generation;
    const transcript = this.state.transcript.trim();
    this.update({ phase: "processing", transcript, message: "" });
    // Unlock local speech on the explicit send gesture, after the mic is closed.
    // iOS can otherwise reject the first reply started after the asynchronous LLM call.
    const acknowledged = this.dependencies
      .speak("確認します。", this.controller.signal)
      .catch(() => {});
    void this.execute(transcript, generation, acknowledged);
  };
  private async execute(transcript: string, generation: number, acknowledged: Promise<void>) {
    try {
      const result = await this.turn(
        {
          transcript,
          expectedTeamId: this.teamId,
          ...(this.pending ? { pendingDraft: this.pending } : {}),
        },
        this.controller.signal,
      );
      if (generation !== this.generation) return;
      this.pending = result.kind === "clarify" ? result.pendingDraft : undefined;
      this.update({ result, phase: "speaking" });
      await acknowledged;
      if (generation !== this.generation) return;
      await this.dependencies.speak(result.replyText, this.controller.signal);
      if (generation === this.generation) this.update({ phase: "done" });
    } catch (error) {
      if (generation !== this.generation) return;
      const message = isApiRequestError(error)
        ? error.message
        : this.state.phase === "speaking" && error instanceof Error
          ? error.message
          : interrupted;
      this.fail(message);
    }
  }
}
