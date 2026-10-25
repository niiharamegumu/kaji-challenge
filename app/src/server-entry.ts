import start from "@tanstack/react-start/server-entry";
import { createRuntime, type RuntimeBindings } from "./server/transport/runtime.server";
import { scheduled } from "./server/transport/scheduled.server";
import { AppError } from "./server/domain/errors";
import { connectRealtime } from "./server/transport/realtime.server";
import { handleMcpHttp, isMcpHttpPath } from "./server/transport/mcp-oauth";
import { boundRequestBody } from "./server/transport/request-body";
import { handleAssistTurn, handleAssistTranscription } from "./server/transport/assist.server";

export { TeamRealtime } from "./server/infrastructure/team-realtime";
export { McpApplication } from "./server/transport/mcp-entrypoint";

function withResponseHeaders(response: Response, path: string): Response {
  // WebSocketを保持したUpgrade応答は通常のHTTP Responseとして作り直さない。
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  if (!headers.has("Referrer-Policy"))
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  if (
    path.startsWith("/api/") ||
    path.startsWith("/.well-known/") ||
    path === "/_serverFn" ||
    path.startsWith("/_serverFn/") ||
    ["/health", "/sw.js", "/registerSW.js", "/manifest.webmanifest"].includes(path)
  )
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleRequest(request: Request, bindings: RuntimeBindings, ctx: ExecutionContext) {
  const path = new URL(request.url).pathname;
  if (path === "/api/assist/turn") return handleAssistTurn(request, bindings);
  if (path === "/api/assist/transcribe") return handleAssistTranscription(request, bindings);
  if (isMcpHttpPath(path)) return handleMcpHttp(request, bindings, ctx);
  if (path === "/api/realtime") {
    try {
      return await connectRealtime(request, bindings);
    } catch {
      console.error(JSON.stringify({ event: "realtime_connection_failed" }));
      return new Response("Connection unavailable", { status: 503 });
    }
  }
  if (path === "/health") return Response.json({ status: "ok", release: bindings.APP_RELEASE });
  if (path.startsWith("/api/auth/")) {
    if (bindings.MAINTENANCE_MODE === "true") return new Response("Maintenance", { status: 503 });
    const bounded = await boundRequestBody(request);
    if (bounded instanceof Response) return bounded;
    try {
      const runtime = createRuntime(bindings);
      return await runtime.auth.handler(bounded);
    } catch (error) {
      if (error instanceof AppError)
        return Response.json(
          { code: error.code, message: error.message },
          { status: error.status },
        );
      // Do not let provider/SQL exceptions reach Workers' uncaught-exception logs.
      console.error(JSON.stringify({ event: "auth_request_failed" }));
      return Response.json(
        {
          code: "internal_error",
          message: "認証処理に失敗しました。時間をおいて再操作してください。",
        },
        { status: 500 },
      );
    }
  }
  if (path === "/_serverFn" || path.startsWith("/_serverFn/")) {
    const bounded = await boundRequestBody(request);
    if (bounded instanceof Response) return bounded;
    return start.fetch(bounded);
  }
  return start.fetch(request);
}

export default {
  scheduled,
  async fetch(request: Request, bindings: RuntimeBindings, ctx: ExecutionContext) {
    return withResponseHeaders(
      await handleRequest(request, bindings, ctx),
      new URL(request.url).pathname,
    );
  },
} satisfies ExportedHandler<RuntimeBindings>;
