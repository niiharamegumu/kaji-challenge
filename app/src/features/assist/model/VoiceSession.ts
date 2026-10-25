import type { AssistDraft, AssistRequest, AssistResult } from "../../../contracts/assist";
import { isApiRequestError } from "../../../lib/api/api-client-state";
import { createCapture } from "../lib/capture";
import { wavBase64 } from "../lib/audio";
import { speakReply } from "../lib/speech";

export type VoiceState = {
  open: boolean;
  phase: "closed" | "starting" | "listening" | "recording" | "processing" | "speaking" | "error";
  result: AssistResult | null;
  message: string;
};
type Dependencies = {
  capture: typeof createCapture;
  speak: typeof speakReply;
};
const interrupted =
  "処理を中断しました。追加されている可能性があります。ToDo一覧を確認してください。";

/** Owns browser resources independently of render timing; every async callback has a generation. */
export class VoiceSession {
  private state: VoiceState = {
    open: false,
    phase: "closed",
    result: null,
    message: "",
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller = new AbortController();
  private capture?: ReturnType<typeof createCapture>;
  private pending?: AssistDraft;
  private sessionTimer?: ReturnType<typeof setTimeout>;
  private restartTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private teamId: string,
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
  private release() {
    this.generation++;
    this.controller.abort();
    clearTimeout(this.restartTimer);
    clearTimeout(this.sessionTimer);
    this.capture?.stop();
    this.capture = undefined;
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
    if (this.state.open) return;
    this.release();
    const generation = this.generation;
    this.update({ open: true, phase: "starting", message: "" });
    this.sessionTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      const processing = this.state.phase === "processing";
      this.close();
      if (!processing)
        this.update({
          message: "音声アシストを終了しました。続けるときはもう一度開いてください。",
        });
    }, 180_000);
    try {
      // Both microphone and initial playback start inside the click event.
      this.capture = this.dependencies.capture({
        onRecording: () => {
          if (generation === this.generation && this.state.phase === "listening")
            this.update({ phase: "recording" });
        },
        onAudio: (wav) => {
          if (generation === this.generation) void this.process(wav, generation);
        },
        onStop: (message, reason) => {
          if (generation !== this.generation) return;
          if (reason === "idle") this.close();
          else this.fail(message);
        },
      });
      const greeting = this.dependencies.speak("どうぞ。", this.controller.signal);
      void Promise.all([this.capture.ready, greeting])
        .then(() => {
          if (generation === this.generation) this.listenAfterReply(generation);
        })
        .catch((error: unknown) => {
          if (generation !== this.generation) return;
          const message =
            error instanceof Error && error.name === "NotAllowedError"
              ? "マイクが許可されていません。ブラウザーの設定でマイクを許可してください。"
              : error instanceof Error
                ? error.message
                : "録音を開始できませんでした。";
          this.fail(message);
        });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "録音を開始できませんでした。");
    }
  };
  private listenAfterReply(generation: number) {
    this.restartTimer = setTimeout(() => {
      void this.listen(generation);
    }, 350);
  }
  private async listen(generation: number) {
    if (generation !== this.generation) return;
    try {
      await this.capture?.listen();
      if (generation === this.generation) this.update({ phase: "listening", message: "" });
    } catch (error) {
      if (generation === this.generation)
        this.fail(error instanceof Error ? error.message : "録音を再開できませんでした。");
    }
  }
  private async process(wav: Uint8Array<ArrayBuffer>, generation: number) {
    if (!["listening", "recording"].includes(this.state.phase)) return;
    this.capture?.disable();
    this.update({ phase: "processing", message: "" });
    try {
      const result = await this.turn(
        {
          audioBase64: wavBase64(wav),
          expectedTeamId: this.teamId,
          ...(this.pending ? { pendingDraft: this.pending } : {}),
        },
        this.controller.signal,
      );
      if (generation !== this.generation) return;
      this.pending = result.kind === "clarify" ? result.pendingDraft : undefined;
      this.update({ result, phase: "speaking" });
      await this.dependencies.speak(result.replyText, this.controller.signal);
      if (generation === this.generation) this.listenAfterReply(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      if (this.state.phase === "processing") this.pending = undefined;
      const message = isApiRequestError(error)
        ? error.message
        : this.state.phase === "speaking" && error instanceof Error
          ? error.message
          : interrupted;
      this.fail(message);
    }
  }
}
