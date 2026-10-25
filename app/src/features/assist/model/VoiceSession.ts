import {
  assistLimits,
  type AssistAudioRequest,
  type AssistDraft,
  type AssistRequest,
  type AssistResult,
} from "../../../contracts/assist";
import { isApiRequestError } from "../../../lib/api/api-client-state";
import { createCapture } from "../lib/capture";
import { wavBase64 } from "../lib/audio";

export type VoiceState = {
  open: boolean;
  phase:
    | "closed"
    | "idle"
    | "starting"
    | "listening"
    | "recording"
    | "transcribing"
    | "submitting"
    | "reviewing"
    | "processing"
    | "done"
    | "error";
  transcript: string;
  submittedTranscript: string;
  result: AssistResult | null;
  message: string;
};
type Dependencies = { capture: typeof createCapture };
const interrupted =
  "処理を中断しました。操作が反映されている可能性があります。ToDo一覧を確認してください。";
const textLimit = `${assistLimits.transcript}文字を超えています。短くしてから送信してください。`;

/** Opening, dictating and submitting are separate user actions. */
export class VoiceSession {
  private state: VoiceState = {
    open: false,
    phase: "closed",
    transcript: "",
    submittedTranscript: "",
    result: null,
    message: "",
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller = new AbortController();
  private capture?: ReturnType<typeof createCapture>;
  private pending?: AssistDraft;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private submitAfterTranscription = false;
  private acceptedAudio = false;
  constructor(
    private teamId: string,
    private transcribe: (
      input: AssistAudioRequest,
      signal: AbortSignal,
    ) => Promise<{ transcript: string }>,
    private turn: (input: AssistRequest, signal: AbortSignal) => Promise<AssistResult>,
    private dependencies: Dependencies = { capture: createCapture },
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
    this.stopCapture();
    this.submitAfterTranscription = false;
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
      submittedTranscript: "",
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
    this.update({
      open: true,
      phase: "idle",
      transcript: "",
      submittedTranscript: "",
      result: null,
      message: "",
    });
  };
  private canEdit() {
    return this.state.open && ["idle", "reviewing", "done", "error"].includes(this.state.phase);
  }
  startRecording = () => {
    if (!this.canEdit()) return;
    this.release();
    const generation = this.generation;
    const base = this.state.transcript;
    this.acceptedAudio = false;
    this.update({ phase: "starting", message: "" });
    this.startupTimer = setTimeout(() => {
      if (generation === this.generation)
        this.fail("マイクを準備できませんでした。もう一度録音してください。");
    }, 30_000);
    try {
      this.capture = this.dependencies.capture({
        onRecording: () => {
          if (generation === this.generation && this.state.phase === "listening")
            this.update({ phase: "recording" });
        },
        onAudio: (wav, limited) => {
          if (generation === this.generation)
            void this.reviewAudio(wav, generation, base, limited ?? false);
        },
        onStop: (message, reason) => {
          if (generation !== this.generation) return;
          if (reason === "idle") {
            this.release();
            this.update({ phase: "idle" });
          } else this.fail(message);
        },
      });
      const capture = this.capture;
      void capture.ready
        .then(async () => {
          if (generation !== this.generation) return;
          await capture.listen();
          if (generation !== this.generation) return;
          clearTimeout(this.startupTimer);
          this.update({ phase: "listening" });
        })
        .catch((error: unknown) => {
          if (generation !== this.generation) return;
          this.fail(
            error instanceof Error && error.name === "NotAllowedError"
              ? "マイクが許可されていません。端末・ブラウザーの設定を確認してください。"
              : error instanceof Error
                ? error.message
                : "録音を開始できませんでした。",
          );
        });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "録音を開始できませんでした。");
    }
  };
  stopRecording = (submit = false) => {
    if (!this.capture || !["listening", "recording"].includes(this.state.phase)) return;
    this.submitAfterTranscription = submit;
    this.update(
      submit
        ? { phase: "submitting", submittedTranscript: "", result: null }
        : { phase: "transcribing" },
    );
    void this.capture.send();
  };
  private async reviewAudio(
    wav: Uint8Array<ArrayBuffer>,
    generation: number,
    base: string,
    limited: boolean,
  ) {
    if (
      this.acceptedAudio ||
      !["listening", "recording", "transcribing", "submitting"].includes(this.state.phase)
    )
      return;
    this.acceptedAudio = true;
    const submit = this.submitAfterTranscription && !limited;
    this.submitAfterTranscription = false;
    this.stopCapture();
    this.update({ phase: submit ? "submitting" : "transcribing" });
    try {
      const result = await this.transcribe(
        { audioBase64: wavBase64(wav), expectedTeamId: this.teamId },
        this.controller.signal,
      );
      if (generation !== this.generation) return;
      const transcript = [base.trimEnd(), result.transcript.trim()].filter(Boolean).join("\n");
      if (submit && transcript.trim() && transcript.length <= assistLimits.transcript) {
        this.submitTranscript(transcript, generation);
        return;
      }
      this.update({
        phase: "reviewing",
        transcript,
        message:
          transcript.length > assistLimits.transcript
            ? textLimit
            : limited
              ? "録音が2分に達したため停止しました。内容を確認して送信してください。"
              : "",
      });
    } catch (error) {
      if (generation === this.generation)
        this.fail(
          isApiRequestError(error)
            ? error.message
            : "文字にできませんでした。入力内容は残っています。もう一度録音してください。",
        );
    }
  }
  editTranscript = (transcript: string) => {
    if (this.canEdit())
      this.update({
        transcript,
        message: transcript.length > assistLimits.transcript ? textLimit : "",
      });
  };
  send = () => {
    if (!this.canEdit()) return;
    const transcript = this.state.transcript.trim();
    if (!transcript) return;
    if (transcript.length > assistLimits.transcript) {
      this.update({ message: textLimit });
      return;
    }
    this.submitTranscript(transcript, this.generation);
  };
  private submitTranscript(transcript: string, generation: number) {
    this.update({
      phase: "processing",
      submittedTranscript: transcript,
      transcript: "",
      result: null,
      message: "",
    });
    void this.execute(transcript, generation);
  }
  private async execute(transcript: string, generation: number) {
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
      this.update({ result, phase: "done" });
    } catch (error) {
      if (generation === this.generation)
        this.fail(isApiRequestError(error) ? error.message : interrupted);
    }
  }
}
