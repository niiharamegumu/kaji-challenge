import {
  assistErrorSchema,
  assistRequestSchema,
  assistResultSchema,
  assistAudioUploadSchema,
  assistTranscriptionSchema,
  type AssistAudioUpload,
  type AssistRequest,
} from "../../../contracts/assist";
import { teamRequestSignal } from "../../../lib/api/serverClient";
import type { ApiRequestError } from "../../../lib/api/api-client-state";

export async function sendAssistTurn(input: AssistRequest, signal: AbortSignal) {
  return assistResultSchema.parse(
    await postAssist("turn", JSON.stringify(assistRequestSchema.parse(input)), signal, {
      "Content-Type": "application/json",
    }),
  );
}

export async function transcribeAssistAudio(input: AssistAudioUpload, signal: AbortSignal) {
  const parsed = assistAudioUploadSchema.parse(input);
  const form = new FormData();
  form.set("audio", parsed.audio, "recording.wav");
  form.set("expectedTeamId", parsed.expectedTeamId);
  return assistTranscriptionSchema.parse(await postAssist("transcribe", form, signal));
}

async function postAssist(
  stage: "turn" | "transcribe",
  body: BodyInit,
  signal: AbortSignal,
  headers?: HeadersInit,
) {
  const combined = AbortSignal.any([signal, teamRequestSignal(), AbortSignal.timeout(35_000)]);
  combined.throwIfAborted();
  const response = await fetch(`/api/assist/${stage}`, {
    method: "POST",
    credentials: "same-origin",
    signal: combined,
    headers,
    body,
  });
  const result: unknown = await response.json();
  combined.throwIfAborted();
  if (!response.ok) {
    const error = assistErrorSchema.safeParse(result);
    throw {
      name: "ApiRequestError",
      status: response.status,
      code: error.success ? error.data.code : "turn_failed",
      message: error.success
        ? error.data.message
        : "結果を確認できません。ToDo一覧を確認してください。",
    } satisfies ApiRequestError;
  }
  return result;
}
