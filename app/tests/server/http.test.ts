vi.mock("../../src/server/infrastructure/team-realtime", () => ({ TeamRealtime: class {} }));
import { beforeEach, expect, it, vi } from "vitest";
import type { RuntimeBindings } from "../../src/server/transport/runtime.server";

const mocks = vi.hoisted(() => ({ start: vi.fn(), createRuntime: vi.fn(), realtime: vi.fn() }));
vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: mocks.start } }));
vi.mock("../../src/server/transport/runtime.server", () => ({
  createRuntime: mocks.createRuntime,
}));
vi.mock("../../src/server/transport/scheduled.server", () => ({ scheduled: vi.fn() }));
vi.mock("../../src/server/transport/realtime.server", () => ({ connectRealtime: mocks.realtime }));
vi.mock("../../src/server/transport/mcp-entrypoint", () => ({ McpApplication: class {} }));
vi.mock("../../src/server/transport/mcp-oauth", () => ({
  isMcpHttpPath: (path: string) => path.startsWith("/api/mcp/") || path.startsWith("/.well-known/"),
  handleMcpHttp: (...args: unknown[]) => mcpHttp(...args),
}));
const mcpHttp = vi.fn();
const ctx = {} as ExecutionContext;
import worker from "../../src/server-entry";
import { MAX_REQUEST_BODY_BYTES } from "../../src/server/transport/request-body";

beforeEach(() => vi.clearAllMocks());
it("protects dynamic HTML and preserves response cookies and redirects", async () => {
  const headers = new Headers({ location: "/", "content-type": "text/html" });
  headers.append("set-cookie", "a=1; HttpOnly");
  headers.append("set-cookie", "b=2; HttpOnly");
  mocks.start.mockResolvedValue(new Response(null, { status: 302, headers }));
  const response = await worker.fetch(
    new Request("https://app.example/calendar"),
    {} as RuntimeBindings,
    ctx,
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/");
  expect(response.headers.getSetCookie()).toHaveLength(2);
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
});
it("does not cache authentication or server function responses", async () => {
  mocks.start.mockResolvedValue(Response.json({ result: "private" }));
  const response = await worker.fetch(
    new Request("https://app.example/_serverFn/test"),
    {} as RuntimeBindings,
    ctx,
  );
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it("keeps health available but blocks authentication during maintenance", async () => {
  const env = { MAINTENANCE_MODE: "true", APP_RELEASE: "test" } as RuntimeBindings;
  const health = await worker.fetch(new Request("https://app.example/health"), env, ctx);
  expect(health.status).toBe(200);
  const auth = await worker.fetch(
    new Request("https://app.example/api/auth/get-session"),
    env,
    ctx,
  );
  expect(auth.status).toBe(503);
  expect(auth.headers.get("cache-control")).toContain("no-store");
  expect(mocks.createRuntime).not.toHaveBeenCalled();
});
it("does not expose unexpected authentication errors in responses or logs", async () => {
  mocks.createRuntime.mockRejectedValueOnce(new Error("database password=private-value"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await worker.fetch(
      new Request("https://app.example/api/auth/get-session"),
      {} as RuntimeBindings,
      ctx,
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "internal_error" });
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: "auth_request_failed" }));
  } finally {
    log.mockRestore();
  }
});

it("preserves the exact WebSocket upgrade response", async () => {
  const upgrade = { status: 101, webSocket: {} };
  mocks.realtime.mockResolvedValue(upgrade);
  expect(
    await worker.fetch(new Request("https://app.example/api/realtime"), {} as RuntimeBindings, ctx),
  ).toBe(upgrade);
});

it("routes OAuth discovery and consent before the SPA and preserves OAuth privacy headers", async () => {
  for (const path of [
    "/.well-known/oauth-authorization-server/api/mcp/oauth",
    "/api/mcp/oauth/authorize",
  ]) {
    mcpHttp.mockResolvedValueOnce(
      new Response("protocol", {
        headers: { "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" },
      }),
    );
    const request = new Request(`https://app.example${path}`);
    const bindings = {} as RuntimeBindings;
    const response = await worker.fetch(request, bindings, ctx);
    expect(mcpHttp).toHaveBeenLastCalledWith(request, bindings, ctx);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toContain("no-store");
  }
  expect(mocks.start).not.toHaveBeenCalled();
});

it.each(["/_serverFn", "/_serverFn/test", "/api/auth/sign-in/social"])(
  "rejects oversized streamed requests before parsing or authentication at %s",
  async (path) => {
    for (const contentLength of [undefined, "1"]) {
      const cancel = vi.fn();
      let reads = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            reads += 1;
            controller.enqueue(new Uint8Array(64 * 1024));
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      const headers = new Headers({ "Content-Type": "application/json" });
      if (contentLength !== undefined) headers.set("Content-Length", contentLength);
      const init = { method: "POST", headers, body, duplex: "half" };
      const response = await worker.fetch(
        new Request(`https://app.example${path}`, init),
        {} as RuntimeBindings,
        ctx,
      );
      expect(response.status).toBe(413);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(cancel).toHaveBeenCalledOnce();
      expect(reads).toBe(MAX_REQUEST_BODY_BYTES / (64 * 1024) + 1);
    }
    expect(mocks.createRuntime).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  },
);

it.each(["/_serverFn/test", "/api/auth/sign-in/social"])(
  "preserves valid request bytes and authentication headers at %s",
  async (path) => {
    const payload = JSON.stringify({
      text: "あ",
      padding: "x".repeat(MAX_REQUEST_BODY_BYTES - 27),
    });
    const bytes = new TextEncoder().encode(payload);
    expect(bytes.byteLength).toBe(MAX_REQUEST_BODY_BYTES);
    const headers = new Headers({
      "Content-Type": "application/json",
      "Content-Length": String(bytes.byteLength),
      Cookie: "session=fixture",
      Origin: "https://app.example",
    });
    const handle = vi.fn(async (request: Request) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe(`https://app.example${path}?trace=test`);
      expect([...request.headers]).toEqual([...headers]);
      expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes);
      return new Response("accepted");
    });
    mocks.start.mockImplementation(handle);
    mocks.createRuntime.mockReturnValue({ auth: { handler: handle } });
    const response = await worker.fetch(
      new Request(`https://app.example${path}?trace=test`, {
        method: "POST",
        headers,
        body: bytes,
      }),
      {} as RuntimeBindings,
      ctx,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("accepted");
    expect(handle).toHaveBeenCalledOnce();
  },
);

it("rejects interrupted request bodies without exposing stream errors or calling Start", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const init = {
    method: "POST",
    duplex: "half",
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("private-body-value"));
      },
    }),
  };
  try {
    const response = await worker.fetch(
      new Request("https://app.example/_serverFn/test", init),
      {} as RuntimeBindings,
      ctx,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid request body");
    expect(log).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});

it("preserves a request split into many single-byte chunks", async () => {
  const bytes = Uint8Array.from({ length: 65_537 }, (_, index) => index % 256);
  let position = 0;
  const init = {
    method: "POST",
    duplex: "half",
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (position === bytes.length) controller.close();
        else {
          controller.enqueue(bytes.slice(position, position + 1));
          position += 1;
        }
      },
    }),
  };
  mocks.start.mockImplementation(async (request: Request) => {
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes);
    return new Response("accepted");
  });
  const response = await worker.fetch(
    new Request("https://app.example/_serverFn/test", init),
    {} as RuntimeBindings,
    ctx,
  );
  expect(response.status).toBe(200);
  expect(mocks.start).toHaveBeenCalledOnce();
});
