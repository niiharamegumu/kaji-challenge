import {
  assistErrorSchema,
  assistRequestSchema,
  assistResultSchema,
  assistAudioRequestSchema,
  assistTranscriptionSchema,
  type AssistAudioRequest,
  type AssistRequest,
} from "../../../contracts/assist";
import { teamRequestSignal } from "../../../lib/api/serverClient";
import type { ApiRequestError } from "../../../lib/api/api-client-state";

export async function sendAssistTurn(input: AssistRequest, signal: AbortSignal) {
  return assistResultSchema.parse(
    await postAssist("turn", assistRequestSchema.parse(input), signal),
  );
}

export async function transcribeAssistAudio(input: AssistAudioRequest, signal: AbortSignal) {
  return assistTranscriptionSchema.parse(
    await postAssist("transcribe", assistAudioRequestSchema.parse(input), signal),
  );
}

async function postAssist(stage: "turn" | "transcribe", input: unknown, signal: AbortSignal) {
  const combined = AbortSignal.any([signal, teamRequestSignal(), AbortSignal.timeout(35_000)]);
  combined.throwIfAborted();
  const response = await fetch(`/api/assist/${stage}`, {
    method: "POST",
    credentials: "same-origin",
    signal: combined,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body: unknown = await response.json();
  combined.throwIfAborted();
  if (!response.ok) {
    const error = assistErrorSchema.safeParse(body);
    throw {
      name: "ApiRequestError",
      status: response.status,
      code: error.success ? error.data.code : "turn_failed",
      message: error.success
        ? error.data.message
        : "結果を確認できません。ToDo一覧を確認してください。",
    } satisfies ApiRequestError;
  }
  return body;
}
