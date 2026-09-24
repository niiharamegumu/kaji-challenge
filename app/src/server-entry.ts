import start from "@tanstack/react-start/server-entry";
import { createRuntime, type RuntimeBindings } from "./server/transport/runtime.server";
import { scheduled } from "./server/transport/scheduled.server";
import { AppError } from "./server/domain/errors";

function withResponseHeaders(response: Response, path: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  if (
    path.startsWith("/api/") ||
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

async function handleRequest(request: Request, bindings: RuntimeBindings) {
  const path = new URL(request.url).pathname;
  if (path === "/health") return Response.json({ status: "ok", release: bindings.APP_RELEASE });
  if (path.startsWith("/api/auth/")) {
    if (bindings.MAINTENANCE_MODE === "true") return new Response("Maintenance", { status: 503 });
    try {
      const runtime = await createRuntime(bindings);
      return await runtime.auth.handler(request);
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
  return start.fetch(request);
}

export default {
  scheduled,
  async fetch(request: Request, bindings: RuntimeBindings) {
    return withResponseHeaders(
      await handleRequest(request, bindings),
      new URL(request.url).pathname,
    );
  },
} satisfies ExportedHandler<RuntimeBindings>;
