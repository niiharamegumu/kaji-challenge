import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import type { ValidatedAccessToken } from "@cloudflare/workers-oauth-provider";
import type { McpPrincipal, McpRequest, McpWireResult } from "../../src/contracts/mcp";

// Only the platform class is mocked. OAuth and the Agents/MCP HTTP handlers are real.
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
import worker, { type McpWorkerBindings } from "../../src/server/transport/mcp-worker";

const mcpOrigin = "https://mcp.example.com";
const resource = `${mcpOrigin}/mcp`;
const appOrigin = "https://app.example.com";
const tokenContext = (userId = "user-a"): ValidatedAccessToken<{ connectionId: string }> => ({
  audience: resource,
  props: { connectionId: "1b6a9835-7d26-46af-b05a-5dd23d075656" },
  userId,
  clientId: "client-a",
  scope: ["todos:read", "todos:write"],
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
});
const validateToken =
  vi.fn<
    (
      resource: string,
      token: string,
    ) => Promise<ValidatedAccessToken<{ connectionId: string }> | null>
  >();
const invoke = vi.fn<(principal: McpPrincipal, request: McpRequest) => Promise<McpWireResult>>();
const env = () =>
  ({
    MCP_ENABLED: "true",
    MAINTENANCE_MODE: "false",
    APP_RELEASE: "test-release",
    MCP_ORIGIN: mcpOrigin,
    APP_ORIGIN: appOrigin,
    KAJI_APPLICATION: { validateToken, invoke },
  }) as unknown as McpWorkerBindings;
const context = (): ExecutionContext =>
  ({
    props: {},
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  }) as unknown as ExecutionContext;
const request = (method: string, params?: unknown, headers: Record<string, string> = {}) =>
  new Request(resource, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "mcp.example.com",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      Authorization: "Bearer test-token",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      ...(params !== undefined ? { params } : {}),
    }),
  });
const call = (name: string, args: unknown = {}, headers: Record<string, string> = {}) =>
  worker.fetch(request("tools/call", { name, arguments: args }, headers), env(), context());

async function payload(response: Response): Promise<unknown> {
  if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
    const data = (await response.text()).split("\n").filter((line) => line.startsWith("data: "));
    expect(data).toHaveLength(1);
    return JSON.parse(data[0].slice(6));
  }
  return response.json();
}

beforeEach(() => {
  validateToken.mockReset().mockResolvedValue(tokenContext());
  invoke.mockReset().mockResolvedValue({ ok: true, data: { items: [], categories: [null] } });
});

describe("MCP HTTP authentication boundary", () => {
  it("publishes only the canonical protected resource metadata and baseline scope", async () => {
    const response = await worker.fetch(
      new Request(`${mcpOrigin}/.well-known/oauth-protected-resource/mcp`),
      env(),
      context(),
    );
    expect(response.status).toBe(200);
    expect(await payload(response)).toMatchObject({
      resource,
      authorization_servers: [`${appOrigin}/api/mcp/oauth`],
      scopes_supported: ["todos:read"],
    });
    expect(validateToken).not.toHaveBeenCalled();
  });

  it("challenges absent credentials and does not trust identity headers", async () => {
    const response = await call(
      "list_todos",
      {},
      { Authorization: "", "x-user-id": "user-a", "x-team-id": "team-a" },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(["revoked", "expired", "wrong-audience"])("rejects %s credentials", async (kind) => {
    validateToken.mockResolvedValue(
      kind === "revoked"
        ? null
        : {
            ...tokenContext(),
            ...(kind === "expired"
              ? { expiresAt: Date.now() / 1000 - 1 }
              : { audience: `${appOrigin}/other` }),
          },
    );
    expect((await call("list_todos")).status).toBe(401);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fails closed on validator errors without exposing the exception", async () => {
    validateToken.mockRejectedValue(new Error("SECRET SQL token"));
    const response = await call("list_todos");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("SECRET");
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    "null",
    "https://evil.example.com",
    "http://chatgpt.com",
    "https://chatgpt.com:444",
    `${appOrigin}/path`,
  ])("rejects the exact untrusted Origin %s before validation", async (origin) => {
    expect((await call("list_todos", {}, { Origin: origin })).status).toBe(403);
    expect(validateToken).not.toHaveBeenCalled();
  });

  it.each([appOrigin, mcpOrigin, "https://chatgpt.com"])(
    "accepts the allowed Origin %s",
    async (origin) => {
      expect((await call("list_todos", {}, { Origin: origin })).status).toBe(200);
      expect(invoke).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a mismatched request URL or Host", async () => {
    expect(
      (await worker.fetch(new Request("https://evil.example.com/mcp"), env(), context())).status,
    ).toBe(403);
    expect((await call("list_todos", {}, { Host: "evil.example.com" })).status).toBe(403);
    expect(validateToken).not.toHaveBeenCalled();
  });

  it.each([{ MCP_ENABLED: "false" }, { MAINTENANCE_MODE: "true" }])(
    "closes the disabled or maintenance gate: %j",
    async (settings) => {
      expect(
        (await worker.fetch(request("tools/list"), { ...env(), ...settings }, context())).status,
      ).toBe(503);
      expect(validateToken).not.toHaveBeenCalled();
    },
  );

  it("returns health with no bindings, identity or tool data", async () => {
    const response = await worker.fetch(new Request(`${mcpOrigin}/health`), env(), context());
    expect(await payload(response)).toEqual({ status: "ok", release: "test-release" });
    expect(validateToken).not.toHaveBeenCalled();
  });

  it.each(["add_todo", "complete_todo"])(
    "challenges the actual read-only token for %s",
    async (name) => {
      validateToken.mockResolvedValue({ ...tokenContext(), scope: ["todos:read"] });
      const response = await call(name, name === "add_todo" ? { name: "Test" } : { itemId: "id" });
      expect(response.status).toBe(403);
      expect(response.headers.get("WWW-Authenticate")).toContain('scope="todos:write"');
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("does not imply read scope from write scope", async () => {
    validateToken.mockResolvedValue({ ...tokenContext(), scope: ["todos:write"] });
    const response = await call("list_todos");
    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain('scope="todos:read"');
    expect(invoke).not.toHaveBeenCalled();
  });

  it("allows add_todo with a write-only token despite the advertised read baseline", async () => {
    validateToken.mockResolvedValue({ ...tokenContext(), scope: ["todos:write"] });
    invoke.mockResolvedValue({
      ok: true,
      data: {
        item: {
          id: "write-only-item",
          name: "Test",
          categoryId: null,
          sortKey: 1,
          createdAt: "2026-10-09T00:00:00Z",
          updatedAt: "2026-10-09T00:00:00Z",
        },
      },
    });
    const response = await call("add_todo", { name: "Test" });
    expect(response.status).toBe(200);
    expect(await payload(response)).toMatchObject({
      result: { structuredContent: { item: { id: "write-only-item" } } },
    });
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ scopes: ["todos:write"] }), {
      tool: "add_todo",
      arguments: { name: "Test" },
    });
  });

  it("limits streamed bodies without relying on Content-Length", async () => {
    const response = await worker.fetch(
      new Request(resource, {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
        body: "x".repeat(128 * 1024 + 1),
      }),
      env(),
      context(),
    );
    expect(response.status).toBe(413);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("MCP tool adapter", () => {
  it("serves modern stateless requests as well as the legacy Streamable HTTP lane", async () => {
    const response = await worker.fetch(
      request(
        "tools/call",
        {
          name: "list_todos",
          arguments: {},
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
            [CLIENT_INFO_META_KEY]: { name: "test-client", version: "1.0" },
            [CLIENT_CAPABILITIES_META_KEY]: {},
          },
        },
        {
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "tools/call",
          "Mcp-Name": "list_todos",
        },
      ),
      env(),
      context(),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await payload(response)).toMatchObject({
      result: { structuredContent: { items: [], categories: [null] } },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("maps add and complete to a single validated business invocation each", async () => {
    const item = {
      id: "todo-id",
      name: "Test",
      notes: "Notes",
      categoryId: null,
      sortKey: 1,
      createdAt: "2026-10-09T00:00:00Z",
      updatedAt: "2026-10-09T00:00:00Z",
    };
    invoke.mockResolvedValueOnce({ ok: true, data: { item } });
    expect(
      await payload(await call("add_todo", { name: "Test", notes: "Notes", categoryId: null })),
    ).toMatchObject({ result: { structuredContent: { item } } });
    expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "user-a" }), {
      tool: "add_todo",
      arguments: { name: "Test", notes: "Notes", categoryId: null },
    });
    invoke.mockResolvedValueOnce({ ok: true, data: { id: item.id, completed: true } });
    expect(await payload(await call("complete_todo", { itemId: item.id }))).toMatchObject({
      result: { structuredContent: { id: item.id, completed: true } },
    });
    expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "user-a" }), {
      tool: "complete_todo",
      arguments: { itemId: item.id },
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("lists exactly the three strict tools and describes the irreversible completion", async () => {
    const response = await worker.fetch(request("tools/list"), env(), context());
    expect(response.status).toBe(200);
    const body = (await payload(response)) as {
      result: {
        tools: Array<{
          name: string;
          inputSchema: { additionalProperties: boolean };
          annotations: Record<string, boolean>;
          description: string;
        }>;
      };
    };
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      "list_todos",
      "add_todo",
      "complete_todo",
    ]);
    for (const tool of body.result.tools) expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(body.result.tools[0].annotations.readOnlyHint).toBe(true);
    expect(body.result.tools[1].annotations.idempotentHint).toBe(false);
    expect(body.result.tools[2].annotations.destructiveHint).toBe(true);
    expect(body.result.tools[2].description).toContain("物理削除");
  });

  it.each([
    ["list_todos", { userId: "victim" }],
    ["list_todos", { teamId: "victim" }],
    ["add_todo", { name: "Test", userId: "victim" }],
    ["complete_todo", { itemId: "id", teamId: "victim" }],
    ["add_todo", { name: "x".repeat(101) }],
    ["complete_todo", {}],
    ["delete_team", {}],
  ])("rejects invalid or unknown %s without invoking the binding", async (name, args) => {
    const response = await call(name as string, args);
    const body = (await payload(response)) as { error?: unknown; result?: { isError?: boolean } };
    expect(Boolean(body.error || body.result?.isError)).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns a JSON-RPC error for malformed JSON", async () => {
    const response = await worker.fetch(
      new Request(request("tools/list"), { method: "POST", body: "{" }),
      env(),
      context(),
    );
    expect(await payload(response)).toHaveProperty("error");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends only verified token identity and validated arguments to the private binding", async () => {
    const response = await call("list_todos", {}, { "x-user-id": "victim", "x-team-id": "victim" });
    expect(await payload(response)).toMatchObject({
      result: { structuredContent: { items: [], categories: [null] } },
    });
    expect(validateToken).toHaveBeenCalledWith(resource, "test-token");
    expect(invoke).toHaveBeenCalledWith(
      {
        userId: "user-a",
        connectionId: tokenContext().props.connectionId,
        clientId: "client-a",
        resource,
        scopes: ["todos:read", "todos:write"],
        expiresAt: expect.any(Number),
      },
      { tool: "list_todos", arguments: {} },
    );
  });

  it("rejects invalid validated props rather than passing an unbound identity", async () => {
    validateToken.mockResolvedValue({ ...tokenContext(), props: { connectionId: "not-a-uuid" } });
    expect(await payload(await call("list_todos"))).toMatchObject({ result: { isError: true } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("isolates two overlapping users and their tool requests", async () => {
    validateToken.mockImplementation(async (_resource, token) => tokenContext(token));
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    invoke.mockImplementation(async (principal) => {
      if (principal.userId === "user-a") await pending;
      else release();
      return {
        ok: true,
        data: {
          items: [],
          categories: [{ id: crypto.randomUUID(), name: principal.userId }, null],
        },
      };
    });
    const responses = await Promise.all([
      call("list_todos", {}, { Authorization: "Bearer user-a" }),
      call("list_todos", {}, { Authorization: "Bearer user-b" }),
    ]);
    for (const [index, response] of responses.entries())
      expect(await payload(response)).toMatchObject({
        result: {
          structuredContent: { categories: [{ name: index === 0 ? "user-a" : "user-b" }, null] },
        },
      });
    expect(invoke.mock.calls.map(([principal]) => principal.userId).sort()).toEqual([
      "user-a",
      "user-b",
    ]);
  });

  it("returns safe business errors and does not retry a write after an interrupted RPC", async () => {
    invoke.mockResolvedValueOnce({
      ok: false,
      error: { status: 403, code: "forbidden", message: "所属を確認してください。" },
    });
    expect(await payload(await call("list_todos"))).toMatchObject({ result: { isError: true } });
    invoke.mockRejectedValueOnce(new Error("SECRET SQL test-token notes"));
    const response = await call("add_todo", { name: "Test" });
    const text = await response.text();
    expect(text).toContain("internal_error");
    expect(text).not.toContain("SECRET");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed output instead of reporting a false successful result", async () => {
    invoke.mockResolvedValue({ ok: true, data: { id: "item", completed: true } });
    expect(await payload(await call("list_todos"))).toMatchObject({ result: { isError: true } });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
