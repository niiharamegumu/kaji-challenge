import {
  OAuthResourceServer,
  insufficientScope,
  type OAuthResourceContext,
} from "@cloudflare/workers-oauth-provider";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import brandIcon from "../../../public/icons/pwa-192x192.png?inline";
import type { McpEnv } from "../../../mcp-worker-configuration";
import {
  AddTodoInputSchema,
  CompleteTodoInputSchema,
  ListTodosInputSchema,
  McpPrincipalSchema,
  McpRequestSchema,
  McpTokenPropsSchema,
  mcpResponseSchemas,
  requiredMcpScope,
  type McpRequest,
} from "../../contracts/mcp";

export type McpWorkerBindings = {
  [K in keyof McpEnv]: McpEnv[K] extends string ? string : McpEnv[K];
};
type ResourceContext = OAuthResourceContext<{ connectionId: string }>;
const MAX_BODY_BYTES = 128 * 1024;
const iconPath = "/icons/kajichalle-192.png";
// Bundle the existing public PNG. This Worker needs no asset binding or network
// request to publish its fixed, non-sensitive brand image on its own origin.
const iconBytes = Uint8Array.from(atob(brandIcon.split(",")[1]), (value) => value.charCodeAt(0));

function toolError(code: string, message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ code, message }) }] };
}

function createServer(env: McpWorkerBindings, ctx: ResourceContext, resource: string) {
  const server = new McpServer({
    name: "KajiChalle",
    version: env.APP_RELEASE,
    icons: [{ src: `${env.MCP_ORIGIN}${iconPath}`, mimeType: "image/png", sizes: ["192x192"] }],
  });
  const invoke = async (request: McpRequest): Promise<CallToolResult> => {
    const input = McpRequestSchema.safeParse(request);
    const props = McpTokenPropsSchema.safeParse(ctx.props);
    const principal = McpPrincipalSchema.safeParse({
      userId: ctx.auth.userId,
      connectionId: props.success ? props.data.connectionId : undefined,
      clientId: ctx.auth.clientId,
      resource: ctx.auth.audience,
      scopes: ctx.auth.scope,
      expiresAt: ctx.auth.expiresAt,
    });
    if (
      !principal.success ||
      principal.data.resource !== resource ||
      principal.data.expiresAt <= Date.now() / 1000
    )
      return toolError("unauthorized", "連携の認証を確認できません。再度接続してください。");
    if (!input.success) return toolError("invalid_request", "入力を確認してください。");
    if (!principal.data.scopes.includes(requiredMcpScope(input.data.tool)))
      return toolError("insufficient_scope", "この操作に必要な連携権限がありません。");

    try {
      // No business retries: an interrupted response may follow a committed mutation.
      const result = await env.KAJI_APPLICATION.invoke(principal.data, input.data);
      if (!result.ok) return toolError(result.error.code, result.error.message);
      const output = mcpResponseSchemas[input.data.tool].parse(result.data);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch {
      return toolError(
        "internal_error",
        "処理結果を確認できません。一覧を再取得して確認してください。",
      );
    }
  };
  server.registerTool(
    "list_todos",
    {
      title: "ToDo一覧",
      description: "現在所属するチームの未完了ToDoとカテゴリーを取得します。",
      inputSchema: ListTodosInputSchema,
      outputSchema: mcpResponseSchemas.list_todos,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) => invoke({ tool: "list_todos", arguments: args }),
  );
  server.registerTool(
    "add_todo",
    {
      title: "ToDo追加",
      description:
        "現在所属するチームにToDoを追加します。カテゴリーIDはlist_todosの結果から指定します。応答不明時は自動再送せず一覧で確認してください。",
      inputSchema: AddTodoInputSchema,
      outputSchema: mcpResponseSchemas.add_todo,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args) => invoke({ tool: "add_todo", arguments: args }),
  );
  server.registerTool(
    "complete_todo",
    {
      title: "ToDo完了",
      description:
        "指定したToDoを完了として直ちに物理削除します。取り消し・復元はできません。対象を確認して実行してください。応答不明時は一覧で確認してください。",
      inputSchema: CompleteTodoInputSchema,
      outputSchema: mcpResponseSchemas.complete_todo,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args) => invoke({ tool: "complete_todo", arguments: args }),
  );
  return server;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function boundedBody(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function handleMcp(request: Request, env: McpWorkerBindings, ctx: ResourceContext) {
  const resource = `${env.MCP_ORIGIN}/mcp`;
  let parsedBody: unknown;
  if (request.method === "POST") {
    const body = await boundedBody(request);
    if (body === null) return new Response("Request too large", { status: 413 });
    // Keep malformed JSON for the SDK's protocol error handling.
    request = new Request(request, { method: "POST", body });
    try {
      parsedBody = JSON.parse(new TextDecoder().decode(body));
    } catch {
      /* The MCP SDK returns the JSON-RPC parse error. */
    }
    if (record(parsedBody) && parsedBody.method === "tools/call" && record(parsedBody.params)) {
      const name = parsedBody.params.name;
      if (name === "list_todos" || name === "add_todo" || name === "complete_todo") {
        const scope = requiredMcpScope(name);
        if (!ctx.auth.scope.includes(scope)) return insufficientScope(ctx.auth, [scope]);
      }
    }
  }
  const handler = createMcpHandler(() => createServer(env, ctx, resource), {
    route: "/mcp",
    corsOptions: false,
    allowedHostnames: [new URL(env.MCP_ORIGIN).hostname],
    // The outer handler checks exact origins, including scheme and port.
    allowedOriginHostnames: "*",
  });
  return handler.fetch(request, {
    ...(parsedBody !== undefined ? { parsedBody } : {}),
    authInfo: {
      token: ctx.auth.token,
      clientId: ctx.auth.clientId ?? "",
      scopes: [...ctx.auth.scope],
      expiresAt: ctx.auth.expiresAt,
      resource: new URL(resource),
    },
  });
}

function configuredOrigin(value: string) {
  const url = new URL(value);
  if (
    url.origin !== value ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("Invalid MCP origin configuration");
  return url.origin;
}

export default {
  async fetch(request: Request, env: McpWorkerBindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && (request.method === "GET" || request.method === "HEAD")) {
      return new Response(
        request.method === "HEAD"
          ? null
          : JSON.stringify({ status: "ok", release: env.APP_RELEASE }),
        {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        },
      );
    }
    if (url.pathname === iconPath) {
      try {
        if (
          url.origin !== configuredOrigin(env.MCP_ORIGIN) ||
          (request.headers.has("Host") && request.headers.get("Host") !== url.host)
        )
          return new Response("Forbidden", { status: 403 });
      } catch {
        return new Response("Service unavailable", { status: 503 });
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      return new Response(request.method === "HEAD" ? null : iconBytes, {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(iconBytes.byteLength),
          "Cache-Control": "public, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (env.MCP_ENABLED !== "true" || env.MAINTENANCE_MODE === "true")
      return new Response("Service unavailable", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    try {
      const mcpOrigin = configuredOrigin(env.MCP_ORIGIN);
      const appOrigin = configuredOrigin(env.APP_ORIGIN);
      const origin = request.headers.get("Origin");
      const host = request.headers.get("Host");
      if (
        url.origin !== mcpOrigin ||
        (host !== null && host !== new URL(mcpOrigin).host) ||
        (origin !== null && ![mcpOrigin, appOrigin, "https://chatgpt.com"].includes(origin))
      )
        return new Response("Forbidden", { status: 403 });

      const server = new OAuthResourceServer<McpWorkerBindings, { connectionId: string }>({
        resourceMetadata: {
          resource: `${mcpOrigin}/mcp`,
          authorization_servers: [`${appOrigin}/api/mcp/oauth`],
          resource_name: "KajiChalle",
        },
        requiredScopes: ["todos:read", "todos:write"],
        validateToken: (bindings) => (resource, token) =>
          bindings.KAJI_APPLICATION.validateToken(resource, token),
        handler: { fetch: handleMcp },
      });
      return await server.fetch(request, env, ctx);
    } catch {
      // Never expose tokens, tool arguments, RPC failures or configuration values.
      return new Response("Service unavailable", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
  },
} satisfies ExportedHandler<McpWorkerBindings>;
