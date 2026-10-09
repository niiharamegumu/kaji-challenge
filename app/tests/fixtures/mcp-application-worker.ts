import { handleMcpHttp, isMcpHttpPath } from "../../src/server/transport/mcp-oauth";
import { createRuntime, type RuntimeBindings } from "../../src/server/transport/runtime.server";

export { McpApplication } from "../../src/server/transport/mcp-entrypoint";
export { TeamRealtime } from "../../src/server/infrastructure/team-realtime";

type FixtureBindings = RuntimeBindings & { MCP_TEST_KV_BARRIER: Fetcher };

function fixtureBindings(request: Request, env: FixtureBindings): RuntimeBindings {
  const mode = request.headers.get("x-fixture-kv-fault");
  if (request.method !== "POST" || new URL(request.url).pathname !== "/api/mcp/oauth/token")
    return env;
  if (mode !== "delete-failure" && mode !== "pause-grant-write") return env;
  // Only this local test entrypoint understands the fault header. Keep the real
  // provider, D1 repository and RPC entrypoint intact; replace KV at its boundary.
  const kv = new Proxy(env.OAUTH_KV, {
    get(target, property) {
      if (property === "delete" && mode === "delete-failure") {
        return async () => {
          throw new Error("Fixture KV delete failure");
        };
      }
      if (property === "put" && mode === "pause-grant-write") {
        return async (...args: Parameters<KVNamespace["put"]>) => {
          if (args[0].startsWith("grant:")) {
            // This binding terminates inside Miniflare's test process. It never
            // uses global fetch or opens an external network connection.
            await env.MCP_TEST_KV_BARRIER.fetch("http://fixture.invalid/paused-grant-write");
          }
          return target.put(...args);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...env, OAUTH_KV: kv };
}

// Exercise the production handlers and named RPC export without the SPA build.
// This fixture exposes no database setup or direct RPC forwarding HTTP endpoint.
export default {
  fetch(
    request: Request,
    env: FixtureBindings,
    ctx: ExecutionContext,
  ): Promise<Response> | Response {
    const path = new URL(request.url).pathname;
    if (isMcpHttpPath(path)) return handleMcpHttp(request, fixtureBindings(request, env), ctx);
    if (path.startsWith("/api/auth/")) return createRuntime(env).auth.handler(request);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<FixtureBindings>;
