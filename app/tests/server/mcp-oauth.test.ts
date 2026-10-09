import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { provisionUser } from "../../src/server/application/provision-user";
import { authorizeMcpConnection } from "../../src/server/application/mcp-operations";
import { McpPrincipalSchema } from "../../src/contracts/mcp";
import { session, user } from "../../src/server/infrastructure/auth-schema";
import { D1McpRepository } from "../../src/server/infrastructure/mcp-repository";
import {
  mcpConnections,
  mcpConsentClaims,
  teamMembers,
} from "../../src/server/infrastructure/schema";
import {
  createMcpAuthorizationServer,
  handleMcpHttp,
  isMcpHttpPath,
} from "../../src/server/transport/mcp-oauth";
import { mcpConsentPage, mcpHtml } from "../../src/server/transport/mcp-pages";
import type { RuntimeBindings } from "../../src/server/transport/runtime.server";
import { createTestDatabase } from "../helpers/d1";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, waitUntil: () => {}, env: {} }));
vi.mock("../../src/server/transport/realtime.server", () => ({ notifyTeams: vi.fn() }));

const origin = "https://app.example.com";
const resource = "https://mcp.example.com/mcp";
const base = `${origin}/api/mcp/oauth`;
const secret = "mcp-local-test-secret-at-least-32-characters";
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ OAUTH_KV: KVNamespace }>>>;
let directory: string;
let bindings: RuntimeBindings;
let repository: D1McpRepository;

beforeAll(async () => {
  database = await createTestDatabase();
  repository = new D1McpRepository(database.db);
  directory = await mkdtemp(join(tmpdir(), "kaji-oauth-kv-test-"));
  const configPath = join(directory, "wrangler.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "oauth-kv-test",
      compatibility_date: "2026-09-14",
      kv_namespaces: [{ binding: "OAUTH_KV", id: "local-only" }],
    }),
  );
  proxy = await getPlatformProxy<{ OAUTH_KV: KVNamespace }>({
    configPath,
    envFiles: [],
    remoteBindings: false,
    persist: false,
  });
  bindings = {
    DB: database.binding,
    OAUTH_KV: proxy.env.OAUTH_KV,
    APP_ORIGIN: origin,
    MCP_ORIGIN: "https://mcp.example.com",
    MCP_ENABLED: "true",
    MAINTENANCE_MODE: "false",
    BETTER_AUTH_SECRET: secret,
    GOOGLE_CLIENT_ID: "fixture",
    GOOGLE_CLIENT_SECRET: "fixture",
    SIGNUP_ALLOWED_EMAILS: "fixture@example.com",
  } as unknown as RuntimeBindings;
});
afterAll(async () => {
  await proxy?.dispose();
  await database?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function identity() {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const token = crypto.randomUUID();
  await database.db
    .insert(user)
    .values({ id: userId, name: "Fixture user", email: `${userId}@example.com` });
  await database.db
    .insert(session)
    .values({ id: sessionId, userId, token, expiresAt: new Date(Date.now() + 86_400_000) });
  await provisionUser(database.repository, userId, new Date());
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return {
    userId,
    sessionId,
    cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  };
}

async function registration() {
  const response = await handleMcpHttp(
    new Request(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://client.example.com" },
      body: JSON.stringify({
        client_name: "Fixture client",
        redirect_uris: ["https://client.example.com/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    }),
    bindings,
    ctx,
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { client_id: string };
}

async function authorization(scope = "todos:read todos:write offline_access") {
  const client = await registration();
  const verifier = "a".repeat(64);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = Buffer.from(hash).toString("base64url");
  const url = new URL(`${base}/authorize`);
  url.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: "https://client.example.com/callback",
    response_type: "code",
    scope,
    state: "fixture-state",
    resource,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { url, clientId: client.client_id, verifier };
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
function hidden(html: string, name: string) {
  const value = html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1];
  if (!value) throw new Error(`Missing ${name} form field`);
  return value.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}
function post(
  path: string,
  form: URLSearchParams,
  cookie: string,
  extra: Record<string, string | null> = {},
) {
  const headers = new Headers({
    Origin: origin,
    "Content-Type": "application/x-www-form-urlencoded",
    Cookie: cookie,
  });
  for (const [name, value] of Object.entries(extra)) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return handleMcpHttp(
    new Request(origin + path, {
      method: "POST",
      headers,
      body: form,
    }),
    bindings,
    ctx,
  );
}
async function consent(scope?: string) {
  const person = await identity();
  const authorizationRequest = await authorization(scope);
  const response = await handleMcpHttp(
    new Request(authorizationRequest.url, { headers: { Cookie: person.cookie } }),
    bindings,
    ctx,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "form-action 'self' https://client.example.com;",
  );
  const html = await response.text();
  const handle = hidden(html, "handle");
  const cookie = `${person.cookie}; ${cookies(response)}`;
  return { ...authorizationRequest, person, html, handle, cookie };
}
function approval(handle: string, scopes = ["todos:read", "todos:write", "offline_access"]) {
  const form = new URLSearchParams({ handle, decision: "approve" });
  scopes.forEach((scope) => form.append("scope", scope));
  return form;
}
async function exchange(
  auth: Awaited<ReturnType<typeof consent>>,
  code: string,
  overrides: Record<string, string> = {},
) {
  return handleMcpHttp(
    new Request(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: auth.clientId,
        code,
        code_verifier: auth.verifier,
        redirect_uri: "https://client.example.com/callback",
        resource,
        ...overrides,
      }),
    }),
    bindings,
    ctx,
  );
}
async function grant(scopes?: string[]) {
  const auth = await consent();
  const approved = await post(
    "/api/mcp/oauth/authorize",
    approval(auth.handle, scopes),
    auth.cookie,
  );
  expect(approved.status).toBe(303);
  const redirect = new URL(approved.headers.get("location")!);
  expect(redirect.searchParams.get("iss")).toBe(base);
  const code = redirect.searchParams.get("code")!;
  const response = await exchange(auth, code);
  expect(response.status).toBe(200);
  const token = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };
  return { auth, token, code };
}

function revokeToken(
  token: string,
  clientId: string,
  tokenType: "access_token" | "refresh_token",
  environment = bindings,
) {
  return handleMcpHttp(
    new Request(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, client_id: clientId, token_type_hint: tokenType }),
    }),
    environment,
    ctx,
  );
}

async function principalForToken(token: string) {
  const context = await createMcpAuthorizationServer(bindings).validateToken<{
    connectionId: string;
  }>(resource, token, bindings);
  if (!context) throw new Error("Expected a valid fixture token");
  return McpPrincipalSchema.parse({
    userId: context.userId,
    clientId: context.clientId,
    connectionId: context.props.connectionId,
    resource: context.audience,
    scopes: context.scope,
    expiresAt: context.expiresAt,
  });
}

it("routes only MCP paths, keeps canonical issuer metadata and fails closed when disabled", async () => {
  expect(isMcpHttpPath("/api/mcp/oauth/token")).toBe(true);
  expect(isMcpHttpPath("/api/mcp/connections")).toBe(true);
  expect(isMcpHttpPath("/.well-known/oauth-authorization-server/api/mcp/oauth")).toBe(true);
  expect(isMcpHttpPath("/api/mcp-elsewhere")).toBe(false);
  const request = new Request(`${origin}/.well-known/oauth-authorization-server/api/mcp/oauth`);
  const response = await handleMcpHttp(request, bindings, ctx);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    scopes_supported: ["todos:read", "todos:write", "offline_access"],
  });
  expect((await handleMcpHttp(request, { ...bindings, MCP_ENABLED: "false" }, ctx)).status).toBe(
    404,
  );
  expect(
    (await handleMcpHttp(request, { ...bindings, MAINTENANCE_MODE: "true" }, ctx)).status,
  ).toBe(503);
  expect(
    (
      await handleMcpHttp(
        new Request("https://other.example.com/api/mcp/oauth/token"),
        bindings,
        ctx,
      )
    ).status,
  ).toBe(404);
});

it("logs only OAuth error classification and omits request values and descriptions", async () => {
  const marker = "private-fixture-marker-not-a-credential";
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const response = await handleMcpHttp(
      new Request(`${base}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams([
          [marker, "one"],
          [marker, "two"],
        ]),
      }),
      bindings,
      ctx,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error_description: string };
    // This provider error deliberately contains a request key in its description.
    expect(body.error_description).toContain(marker);
    expect(warn).toHaveBeenCalledWith(
      JSON.stringify({ event: "mcp_oauth_error", code: "invalid_request", status: 400 }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("description");
  } finally {
    warn.mockRestore();
  }
});

it("validates OAuth requests before showing the login form and preserves the same-origin callback", async () => {
  const auth = await authorization();
  const page = await handleMcpHttp(new Request(auth.url), bindings, ctx);
  expect(page.status).toBe(200);
  expect(page.headers.get("Content-Security-Policy")).toContain(
    "form-action 'self' https://accounts.google.com;",
  );
  const html = await page.text();
  const url = hidden(html, "authorizationUrl");
  expect(url).toBe(auth.url.href);
  const response = await post(
    "/api/mcp/oauth/login",
    new URLSearchParams({ authorizationUrl: url }),
    "",
  );
  expect(response.status).toBe(303);
  expect(new URL(response.headers.get("Location")!).hostname).toBe("accounts.google.com");
  expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
  expect(
    (
      await post(
        "/api/mcp/oauth/login",
        new URLSearchParams({ authorizationUrl: "https://evil.example/" }),
        "",
      )
    ).status,
  ).toBe(400);
});

it.each([undefined, "1"])(
  "cancels oversized browser-form streams even with untrusted Content-Length %s",
  async (declaredLength) => {
    let pulls = 0;
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 16) controller.close();
        else controller.enqueue(new Uint8Array(4096).fill(0x61));
      },
      cancel() {
        canceled = true;
      },
    });
    const headers = new Headers({
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    });
    if (declaredLength) headers.set("Content-Length", declaredLength);
    const init = { method: "POST", headers, body, duplex: "half" };
    const response = await handleMcpHttp(new Request(`${base}/login`, init), bindings, ctx);
    expect(response.status).toBe(413);
    expect(canceled).toBe(true);
    expect(pulls).toBeLessThan(16);
  },
);

it("limits form bytes rather than decoded character count", async () => {
  const body = "authorizationUrl=" + "あ".repeat(6000);
  expect(body.length).toBeLessThan(16_384);
  const response = await handleMcpHttp(
    new Request(`${base}/login`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }),
    bindings,
    ctx,
  );
  expect(response.status).toBe(413);
});

it.each([
  ["scope", "todos:read admin"],
  ["scope", "offline_access"],
  ["code_challenge_method", "plain"],
  ["code_challenge", "bad"],
  ["resource", "https://other.example.com/mcp"],
  ["redirect_uri", "https://evil.example/callback"],
])("rejects invalid authorization %s=%s", async (key, value) => {
  const auth = await authorization();
  auth.url.searchParams.set(key, value);
  const response = await handleMcpHttp(new Request(auth.url), bindings, ctx);
  expect([400, 303]).toContain(response.status);
  if (response.status === 303) {
    const destination = new URL(response.headers.get("Location")!);
    expect(destination.origin).toBe("https://client.example.com");
    expect(destination.searchParams.has("error")).toBe(true);
  }
});

it("rejects registered private-use and opaque redirect schemes at authorization", async () => {
  const auth = await authorization();
  const oauth = createMcpAuthorizationServer(bindings).getOAuthApi(bindings);
  await oauth.updateClient(auth.clientId, {
    redirectUris: ["https://client.example.com/callback", "com.example.app:/callback"],
  });
  auth.url.searchParams.set("redirect_uri", "com.example.app:/callback");
  const response = await handleMcpHttp(new Request(auth.url), bindings, ctx);
  expect(response.status).toBe(400);
  expect(response.headers.get("Location")).toBeNull();
});

it("rejects IPv6 literal callbacks before login because Chromium cannot allow them in CSP", async () => {
  const auth = await authorization();
  const ipv6 = "http://[::1]:3456/callback";
  const oauth = createMcpAuthorizationServer(bindings).getOAuthApi(bindings);
  await oauth.updateClient(auth.clientId, { redirectUris: [ipv6] });
  auth.url.searchParams.set("redirect_uri", ipv6);
  const response = await handleMcpHttp(new Request(auth.url), bindings, ctx);
  expect(response.status).toBe(400);
  expect(response.headers.get("Location")).toBeNull();
  expect(await response.text()).toContain("IPv6 アドレスの戻り先には対応していません");
});

it.each<Record<string, string | null>>([
  { Origin: "https://evil.example" },
  { Origin: "" },
  { Origin: "null" },
  { Origin: null },
  { "Sec-Fetch-Site": "cross-site" },
])("rejects forged browser POST before consuming consent: %j", async (headers) => {
  const auth = await consent();
  expect(
    (await post("/api/mcp/oauth/authorize", approval(auth.handle), auth.cookie, headers)).status,
  ).toBe(403);
  expect((await post("/api/mcp/oauth/authorize", approval(auth.handle), auth.cookie)).status).toBe(
    303,
  );
});

it("binds consent to user, session and browser and consumes it exactly once", async () => {
  const auth = await consent();
  const other = await identity();
  const nonce = auth.cookie.split("; ").slice(1).join("; ");
  expect(
    (await post("/api/mcp/oauth/authorize", approval(auth.handle), `${other.cookie}; ${nonce}`))
      .status,
  ).toBe(400);
  expect((await post("/api/mcp/oauth/authorize", approval(auth.handle), auth.cookie)).status).toBe(
    303,
  );
  expect((await post("/api/mcp/oauth/authorize", approval(auth.handle), auth.cookie)).status).toBe(
    400,
  );
  expect(await repository.listConnections(auth.person.userId)).toHaveLength(1);
});

it("rejects an expired claim, a missing browser nonce and a different session of the same user", async () => {
  const expired = await consent();
  await database.db
    .update(mcpConsentClaims)
    .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .where(eq(mcpConsentClaims.user_id, expired.person.userId));
  expect(
    (await post("/api/mcp/oauth/authorize", approval(expired.handle), expired.cookie)).status,
  ).toBe(400);
  expect(await repository.listConnections(expired.person.userId)).toEqual([]);

  const unbound = await consent();
  expect(
    (await post("/api/mcp/oauth/authorize", approval(unbound.handle), unbound.person.cookie))
      .status,
  ).toBe(400);
  expect(await repository.listConnections(unbound.person.userId)).toEqual([]);

  const changed = await consent();
  const token = crypto.randomUUID();
  await database.db.insert(session).values({
    id: crypto.randomUUID(),
    userId: changed.person.userId,
    token,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  const newCookie = `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}; ${changed.cookie.split("; ").slice(1).join("; ")}`;
  expect((await post("/api/mcp/oauth/authorize", approval(changed.handle), newCookie)).status).toBe(
    400,
  );
  expect(
    (await post("/api/mcp/oauth/authorize", approval(changed.handle), changed.cookie)).status,
  ).toBe(303);
});

it("rejects expired sessions and revoked membership without creating a connection", async () => {
  const auth = await consent();
  await database.db.delete(session).where(eq(session.id, auth.person.sessionId));
  expect((await post("/api/mcp/oauth/authorize", approval(auth.handle), auth.cookie)).status).toBe(
    401,
  );
  const noTeam = await consent();
  await database.db.delete(teamMembers).where(eq(teamMembers.user_id, noTeam.person.userId));
  expect(
    (await post("/api/mcp/oauth/authorize", approval(noTeam.handle), noTeam.cookie)).status,
  ).toBe(403);
  expect(await repository.listConnections(noTeam.person.userId)).toEqual([]);
});

it("denies without issuing a grant and cannot add unrequested scopes", async () => {
  const auth = await consent();
  const denied = await post(
    "/api/mcp/oauth/authorize",
    new URLSearchParams({ handle: auth.handle, decision: "deny" }),
    auth.cookie,
  );
  expect(denied.status).toBe(303);
  expect(new URL(denied.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
  expect(await repository.listConnections(auth.person.userId)).toEqual([]);
  const read = await consent("todos:read");
  expect((await post("/api/mcp/oauth/authorize", approval(read.handle), read.cookie)).status).toBe(
    400,
  );
  expect(await repository.listConnections(read.person.userId)).toEqual([]);
});

it("issues audience-bound, scoped 15-minute access with optional fixed-lifetime refresh", async () => {
  const { auth, token, code } = await grant();
  expect(token.expires_in).toBeLessThanOrEqual(900);
  expect(token.refresh_token).toBeTruthy();
  const valid = await createMcpAuthorizationServer(bindings).validateToken(
    resource,
    token.access_token,
    bindings,
  );
  expect(valid).toMatchObject({
    audience: resource,
    scope: ["todos:read", "todos:write", "offline_access"],
    userId: auth.person.userId,
    clientId: auth.clientId,
  });
  expect((await repository.listConnections(auth.person.userId))[0].grantId).toBeTruthy();
  expect((await exchange(auth, code)).status).toBe(400);
  const withoutOffline = await grant(["todos:read"]);
  expect(withoutOffline.token.refresh_token).toBeUndefined();
  expect(withoutOffline.token.scope).toBe("todos:read");
});

it("caps access and refresh grant expiry at the D1 connection's original deadline", async () => {
  const auth = await consent();
  const approved = await post("/api/mcp/oauth/authorize", approval(auth.handle), auth.cookie);
  const code = new URL(approved.headers.get("Location")!).searchParams.get("code")!;
  const connection = (await repository.listConnections(auth.person.userId))[0];
  const deadline = new Date(Date.now() + 120_000);
  await database.db
    .update(mcpConnections)
    .set({ expires_at: deadline.toISOString() })
    .where(eq(mcpConnections.id, connection.id));
  const response = await exchange(auth, code);
  expect(response.status).toBe(200);
  const token = (await response.json()) as { expires_in: number; refresh_token?: string };
  expect(token.expires_in).toBeLessThanOrEqual(120);
  expect(token.refresh_token).toBeTruthy();
  const grants = await createMcpAuthorizationServer(bindings)
    .getOAuthApi(bindings)
    .listUserGrants(auth.person.userId);
  expect(grants.items).toHaveLength(1);
  expect(grants.items[0].expiresAt).toBeLessThanOrEqual(Math.floor(deadline.getTime() / 1000));
});

it.each(["code_verifier", "client_id", "resource"])(
  "refuses an authorization code with mismatched %s",
  async (field) => {
    const auth = await consent();
    const response = await post("/api/mcp/oauth/authorize", approval(auth.handle), auth.cookie);
    const code = new URL(response.headers.get("Location")!).searchParams.get("code")!;
    const result = await exchange(auth, code, {
      [field]: field === "resource" ? "https://wrong.example/mcp" : "invalid",
    });
    expect([400, 401]).toContain(result.status);
    expect(await result.json()).not.toHaveProperty("access_token");
    expect((await repository.listConnections(auth.person.userId))[0].grantId).toBeNull();
  },
);

it("uses the refresh request's reduced scope and rejects expired D1 connections", async () => {
  const { auth, token } = await grant();
  const refresh = (refreshToken: string, scope = "todos:read") =>
    handleMcpHttp(
      new Request(`${base}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: auth.clientId,
          refresh_token: refreshToken,
          resource,
          scope,
        }),
      }),
      bindings,
      ctx,
    );
  const reduced = await refresh(token.refresh_token!);
  expect(reduced.status).toBe(200);
  const result = (await reduced.json()) as { access_token: string; refresh_token: string };
  const context = await createMcpAuthorizationServer(bindings).validateToken(
    resource,
    result.access_token,
    bindings,
  );
  expect(context?.scope).toEqual(["todos:read"]);
  const connection = (await repository.listConnections(auth.person.userId))[0];
  await database.db
    .update(mcpConnections)
    .set({ created_at: "2025-01-01T00:00:00.000Z", expires_at: "2025-01-02T00:00:00.000Z" })
    .where(eq(mcpConnections.id, connection.id));
  expect((await refresh(result.refresh_token)).status).toBe(400);
});

it("rechecks membership and D1 revocation during refresh", async () => {
  for (const change of ["membership", "revoke"] as const) {
    const { auth, token } = await grant();
    const connection = (await repository.listConnections(auth.person.userId))[0];
    if (change === "membership")
      await database.db.delete(teamMembers).where(eq(teamMembers.user_id, auth.person.userId));
    else
      await repository.revokeConnection(
        connection.id,
        auth.person.userId,
        new Date().toISOString(),
      );
    const response = await handleMcpHttp(
      new Request(`${base}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: auth.clientId,
          refresh_token: token.refresh_token!,
          resource,
        }),
      }),
      bindings,
      ctx,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
  }
});

it("lists only the current user's connections and requires a one-use session-bound revoke form", async () => {
  const { auth, token } = await grant();
  const other = await identity();
  const response = await handleMcpHttp(
    new Request(`${origin}/api/mcp/connections`, { headers: { Cookie: auth.person.cookie } }),
    bindings,
    ctx,
  );
  const html = await response.text();
  const connectionId = hidden(html, "connectionId");
  const handle = hidden(html, "handle");
  const otherPage = await handleMcpHttp(
    new Request(`${origin}/api/mcp/connections`, { headers: { Cookie: other.cookie } }),
    bindings,
    ctx,
  );
  expect(await otherPage.text()).not.toContain(connectionId);
  const form = new URLSearchParams({ connectionId, handle });
  expect((await post("/api/mcp/connections/revoke", form, other.cookie)).status).toBe(400);
  expect((await post("/api/mcp/connections/revoke", form, auth.person.cookie)).status).toBe(303);
  expect((await repository.getConnection(connectionId))?.revokedAt).toBeTruthy();
  expect(
    await createMcpAuthorizationServer(bindings).validateToken(
      resource,
      token.access_token,
      bindings,
    ),
  ).toBeNull();
  expect((await post("/api/mcp/connections/revoke", form, auth.person.cookie)).status).toBe(400);
});

it("keeps D1 revocation effective when KV revocation fails and permits an explicit retry", async () => {
  const { auth } = await grant();
  const response = await handleMcpHttp(
    new Request(`${origin}/api/mcp/connections`, { headers: { Cookie: auth.person.cookie } }),
    bindings,
    ctx,
  );
  const html = await response.text();
  const connectionId = hidden(html, "connectionId");
  const failedKv = new Proxy(proxy.env.OAUTH_KV, {
    get(target, key) {
      if (key === "delete")
        return async () => {
          throw new Error("fixture KV outage");
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const failed = await handleMcpHttp(
    new Request(`${origin}/api/mcp/connections/revoke`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: auth.person.cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ connectionId, handle: hidden(html, "handle") }),
    }),
    { ...bindings, OAUTH_KV: failedKv },
    ctx,
  );
  expect(failed.status).toBe(503);
  expect((await repository.getConnection(connectionId))?.revokedAt).toBeTruthy();
  const retryPage = await handleMcpHttp(
    new Request(`${origin}/api/mcp/connections`, { headers: { Cookie: auth.person.cookie } }),
    bindings,
    ctx,
  );
  const retryHtml = await retryPage.text();
  expect(retryHtml).toContain("トークンの失効を再実行");
  expect(
    (
      await post(
        "/api/mcp/connections/revoke",
        new URLSearchParams({ connectionId, handle: hidden(retryHtml, "handle") }),
        auth.person.cookie,
      )
    ).status,
  ).toBe(303);
});

it.each(["access_token", "refresh_token"] as const)(
  "stops the D1 connection on verified RFC 7009 %s revocation and keeps retries idempotent",
  async (tokenType) => {
    const { auth, token } = await grant();
    const principal = await principalForToken(token.access_token);
    const response = await revokeToken(token[tokenType]!, auth.clientId, tokenType);
    expect(response.status).toBe(200);
    const revoked = await repository.getConnection(principal.connectionId);
    expect(revoked?.revokedAt).toBeTruthy();
    await expect(authorizeMcpConnection(repository, principal, new Date())).rejects.toMatchObject({
      status: 401,
    });
    expect((await revokeToken(token[tokenType]!, auth.clientId, tokenType)).status).toBe(200);
    expect((await repository.getConnection(principal.connectionId))?.revokedAt).toBe(
      revoked?.revokedAt,
    );
    const refresh = await handleMcpHttp(
      new Request(`${base}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: auth.clientId,
          refresh_token: token.refresh_token!,
          resource,
        }),
      }),
      bindings,
      ctx,
    );
    expect(refresh.status).toBe(400);
    expect(await refresh.json()).toMatchObject({ error: "invalid_grant" });
  },
);

it.each(["access_token", "refresh_token"] as const)(
  "ignores a different client's RFC 7009 %s without changing D1 or the grant",
  async (tokenType) => {
    const { auth, token } = await grant();
    const otherClient = await registration();
    const principal = await principalForToken(token.access_token);
    // RFC 7009 deliberately returns the same success for unknown/not-owned tokens.
    expect((await revokeToken(token[tokenType]!, otherClient.client_id, tokenType)).status).toBe(
      200,
    );
    expect((await repository.getConnection(principal.connectionId))?.revokedAt).toBeNull();
    await expect(authorizeMcpConnection(repository, principal, new Date())).resolves.toMatchObject({
      clientId: auth.clientId,
      revokedAt: null,
    });
    expect(
      await createMcpAuthorizationServer(bindings).validateToken(
        resource,
        token.access_token,
        bindings,
      ),
    ).not.toBeNull();
    expect((await revokeToken("invalid-fixture-token", auth.clientId, tokenType)).status).toBe(200);
    expect((await repository.getConnection(principal.connectionId))?.revokedAt).toBeNull();
  },
);

it.each(["access_token", "refresh_token"] as const)(
  "returns 503 and retains the provider token when D1 RFC 7009 %s revocation fails",
  async (tokenType) => {
    const { auth, token } = await grant();
    const principal = await principalForToken(token.access_token);
    await database.db.run(sql`CREATE TRIGGER reject_mcp_revocation
      BEFORE UPDATE OF revoked_at ON mcp_connections
      BEGIN SELECT RAISE(ABORT, 'fixture D1 outage'); END`);
    try {
      const response = await revokeToken(token[tokenType]!, auth.clientId, tokenType);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: "temporarily_unavailable" });
      expect((await repository.getConnection(principal.connectionId))?.revokedAt).toBeNull();
      expect(
        await createMcpAuthorizationServer(bindings).validateToken(
          resource,
          token.access_token,
          bindings,
        ),
      ).not.toBeNull();
    } finally {
      await database.db.run(sql`DROP TRIGGER reject_mcp_revocation`);
    }
    expect((await revokeToken(token[tokenType]!, auth.clientId, tokenType)).status).toBe(200);
    await expect(authorizeMcpConnection(repository, principal, new Date())).rejects.toMatchObject({
      status: 401,
    });
  },
);

it.each(["access_token", "refresh_token"] as const)(
  "keeps D1 denial after RFC 7009 %s reaches a failing KV delete",
  async (tokenType) => {
    const { auth, token } = await grant();
    const principal = await principalForToken(token.access_token);
    let deleteAttempted = false;
    let d1RevokedBeforeDelete = false;
    const failedKv = new Proxy(proxy.env.OAUTH_KV, {
      get(target, key) {
        if (key === "delete")
          return async () => {
            deleteAttempted = true;
            // The provider must await the application's D1 revocation first.
            d1RevokedBeforeDelete = Boolean(
              (await repository.getConnection(principal.connectionId))?.revokedAt,
            );
            throw new Error("fixture KV outage");
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const response = await revokeToken(token[tokenType]!, auth.clientId, tokenType, {
      ...bindings,
      OAUTH_KV: failedKv,
    });
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(deleteAttempted).toBe(true);
    expect(d1RevokedBeforeDelete).toBe(true);
    expect((await repository.getConnection(principal.connectionId))?.revokedAt).toBeTruthy();
    // Even if KV still validates the old token, application authorization refuses it.
    expect(
      await createMcpAuthorizationServer(bindings).validateToken(
        resource,
        token.access_token,
        bindings,
      ),
    ).not.toBeNull();
    await expect(authorizeMcpConnection(repository, principal, new Date())).rejects.toMatchObject({
      status: 401,
    });
    expect((await revokeToken(token[tokenType]!, auth.clientId, tokenType)).status).toBe(200);
  },
);

it("rejects an unsupported client authentication method before RFC 7009 revocation", async () => {
  const { auth, token } = await grant();
  const principal = await principalForToken(token.access_token);
  // The registered public client permits 'none', never client_secret_basic.
  const authorization = Buffer.from(`${auth.clientId}:incorrect-fixture-secret`).toString("base64");
  const response = await handleMcpHttp(
    new Request(`${base}/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token: token.access_token, token_type_hint: "access_token" }),
    }),
    bindings,
    ctx,
  );
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: "invalid_client" });
  expect((await repository.getConnection(principal.connectionId))?.revokedAt).toBeNull();
  expect(
    await createMcpAuthorizationServer(bindings).validateToken(
      resource,
      token.access_token,
      bindings,
    ),
  ).not.toBeNull();
});

it("does not revoke KV when the verified token has no matching D1 client/grant", async () => {
  const { auth, token } = await grant();
  const principal = await principalForToken(token.access_token);
  await database.db
    .update(mcpConnections)
    .set({ client_id: "different-fixture-client" })
    .where(eq(mcpConnections.id, principal.connectionId));
  const response = await revokeToken(token.access_token, auth.clientId, "access_token");
  expect(response.status).toBe(503);
  expect((await repository.getConnection(principal.connectionId))?.revokedAt).toBeNull();
  expect(
    await createMcpAuthorizationServer(bindings).validateToken(
      resource,
      token.access_token,
      bindings,
    ),
  ).not.toBeNull();
});

it("escapes untrusted consent text and explains local-app redirects and permanent access", () => {
  const html = mcpConsentPage(
    {
      clientId: "fixture",
      clientName: '<img src=x onerror="evil()">',
      clientDomain: "evil<domain>",
      redirectUri: "http://localhost:3456/callback",
      redirectHost: "localhost",
      redirectIsLoopback: true,
      scope: ["todos:write", "offline_access", "<script>alert(1)</script>"],
    },
    '"bad-handle',
    "<user>",
    "<team>",
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<script>");
  expect(html).toContain("この端末で動くアプリ");
  expect(html).toContain("ログアウトでは解除されません");
  expect(html).toContain("完了した ToDo は削除されます");
});

it.each([
  "https://*.example.com/callback",
  "https://good.example;script-src/'unsafe-inline'",
  "https://user:password@example.com/callback",
  "https://example.com/callback#fragment",
  "http://remote.example.com/callback",
  "http://[::1]:3456/callback",
  "javascript:alert(1)",
  "com.example.app:/callback",
  "data:text/html,hello",
])("rejects unsafe CSP destination %s", (destination) => {
  expect(() => mcpHtml("", 200, undefined, destination)).toThrow();
});

it.each([
  ["https://client.example.com/callback?state=a%3Bscript-src", "https://client.example.com"],
  ["http://127.0.0.1:4567/callback", "http://127.0.0.1:4567"],
  ["http://localhost:9876/callback", "http://localhost:9876"],
])("allows only the canonical form redirect origin: %s", (destination, allowedOrigin) => {
  expect(mcpHtml("", 200, undefined, destination).headers.get("Content-Security-Policy")).toBe(
    `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${allowedOrigin}; frame-ancestors 'none'; base-uri 'none'`,
  );
  expect(mcpHtml("").headers.get("Content-Security-Policy")).toContain("form-action 'self';");
});
