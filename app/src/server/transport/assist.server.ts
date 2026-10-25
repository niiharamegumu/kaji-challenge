import {
  assistAudioRequestSchema,
  assistRequestSchema,
  assistLimits,
} from "../../contracts/assist";
import { executeAssistTurn, transcribeAssistAudio } from "../application/assist-operations";
import { AppError } from "../domain/errors";
import { createAssistBudget } from "../infrastructure/assist-budget";
import { createAssistAi } from "../infrastructure/assist-ai";
import { validateAssistAudio } from "./assist-audio";
import { readBoundedBody, MAX_REQUEST_BODY_BYTES } from "./request-body";
import { createRuntime, notifyChanges, type RuntimeBindings } from "./runtime.server";

export async function handleAssistTurn(
  request: Request,
  bindings: RuntimeBindings,
): Promise<Response> {
  return handleAssistRequest(request, bindings, "execute");
}

export async function handleAssistTranscription(request: Request, bindings: RuntimeBindings) {
  return handleAssistRequest(request, bindings, "transcribe");
}

async function handleAssistRequest(
  request: Request,
  bindings: RuntimeBindings,
  stage: "transcribe" | "execute",
): Promise<Response> {
  const start = Date.now();
  let status = 200;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 30_000);
  const signal = AbortSignal.any([request.signal, timeout.signal]);
  try {
    if (request.method !== "POST")
      throw new AppError(405, "method_not_allowed", "POSTで送信してください。");
    if (
      request.headers.get("origin") !== bindings.APP_ORIGIN ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new AppError(403, "forbidden", "この操作はアプリから行ってください。");
    if (bindings.MAINTENANCE_MODE === "true")
      throw new AppError(503, "maintenance", "メンテナンス中です。");
    if (bindings.ASSIST_ENABLED !== "true")
      throw new AppError(503, "assist_disabled", "音声アシストはまだ有効になっていません。");
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
      throw new AppError(415, "unsupported_media_type", "JSONで送信してください。");
    const runtime = createRuntime(bindings);
    const session = await runtime.auth.api.getSession({ headers: request.headers });
    if (!session) throw new AppError(401, "unauthorized", "ログインし直してください。");
    const repository = runtime.repository.forSession(session.user.id, session.session.id);
    await repository.assertAccess();
    const limit = await bindings.ASSIST_LIMITER.limit({ key: session.user.id });
    if (!limit.success) throw new AppError(429, "rate_limited", "少し待ってから再開してください。");
    const bytes = await readBoundedBody(
      request,
      stage === "transcribe" ? assistLimits.audioBodyBytes : MAX_REQUEST_BODY_BYTES,
    );
    if (!bytes) throw new AppError(413, "body_too_large", "音声が長すぎます。短く話してください。");
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new AppError(400, "invalid_request", "入力を確認できません。");
    }
    const ai = createAssistAi(bindings.AI, bindings.ASSIST_GATEWAY_ID);
    const context = { userId: session.user.id, signal, budget: createAssistBudget(runtime.db) };
    if (stage === "transcribe") {
      const parsed = assistAudioRequestSchema.safeParse(raw);
      if (!parsed.success) throw new AppError(400, "invalid_request", "入力を確認できません。");
      validateAssistAudio(parsed.data.audioBase64);
      return Response.json(await transcribeAssistAudio(repository, ai, parsed.data, context));
    }
    const parsed = assistRequestSchema.safeParse(raw);
    if (!parsed.success) throw new AppError(400, "invalid_request", "入力を確認できません。");
    signal.throwIfAborted();
    const result = await executeAssistTurn(repository, ai, parsed.data, context);
    if (result.changedTeams.length) {
      try {
        notifyChanges(bindings, result.changedTeams, ["todos"]);
      } catch {
        console.error(JSON.stringify({ event: "assist_notification_failed" }));
      }
    }
    return Response.json(result.data);
  } catch (error) {
    status = error instanceof AppError ? error.status : signal.aborted ? 504 : 503;
    return Response.json(
      {
        code:
          error instanceof AppError
            ? error.code
            : signal.aborted
              ? "turn_interrupted"
              : "turn_failed",
        message:
          error instanceof AppError
            ? error.message
            : stage === "transcribe"
              ? "文字起こしを完了できませんでした。ToDoは操作していません。もう一度録音してください。"
              : "処理結果を確認できません。追加されている可能性があります。ToDo一覧を確認してください。",
      },
      { status, headers: status === 429 ? { "Retry-After": "60" } : undefined },
    );
  } finally {
    clearTimeout(timer);
    console.info(
      JSON.stringify({
        event: stage === "transcribe" ? "assist_transcription" : "assist_turn",
        status,
        durationMs: Date.now() - start,
      }),
    );
  }
}
