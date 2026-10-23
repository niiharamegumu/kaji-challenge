import type { AssistDraft } from "../../contracts/assist";

export interface AssistAi {
  transcribe(audioBase64: string, signal: AbortSignal): Promise<string>;
  interpret(
    transcript: string,
    pendingDraft: AssistDraft | undefined,
    signal: AbortSignal,
  ): Promise<unknown>;
}

/** Reserves a turn before any paid inference. Never refunds uncertain/failed requests. */
export interface AssistBudget {
  reserve(): Promise<void>;
}
