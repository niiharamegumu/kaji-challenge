import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { Log, LogLevel, Miniflare, convertV4MiniflareOptions } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { afterAll, beforeAll, expect, it } from "vitest";

const appOrigin = "https://app.example.com";
const mcpOrigin = "http://localhost:5176";
const resource = `${mcpOrigin}/mcp`;
const issuer = `${appOrigin}/api/mcp/oauth`;
const redirectUri = "https://client.example.com/callback";
const fixtureSecret = "isolated-workers-fixture-secret-at-least-32-characters";
type Worker = Awaited<ReturnType<Miniflare["getWorker"]>>;
type WorkerResponse = Awaited<ReturnType<Worker["fetch"]>>;
type Tokens = { access_token: string; refresh_token?: string; scope: string; expires_in: number };
type ToolResult = {
  isError?: boolean;
  content?: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};
type RpcMessage = {
  id?: number;
  result?: Record<string, unknown> & ToolResult;
  error?: { code: number; message: string };
};
let directory: string;
let miniflare: Miniflare;
let app: Worker;
let db: Awaited<ReturnType<Miniflare["getD1Database"]>>;
let kv: Awaited<ReturnType<Miniflare["getKVNamespace"]>>;
let messageId = 0;
let grantWriteBarrier: { reached: () => void; resume: Promise<void> } | undefined;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "kaji-mcp-workers-"));
  const appScript = join(directory, "application.mjs");
  const mcpScript = join(directory, "mcp.mjs");
  const [appBundle, mcpBundle] = await Promise.all(
    [
      ["tests/fixtures/mcp-application-worker.ts", appScript],
      ["src/server/transport/mcp-worker.ts", mcpScript],
    ].map(([entry, outfile]) =>
      build({
        entryPoints: [entry],
        outfile,
        write: false,
        bundle: true,
        format: "esm",
        platform: "neutral",
        target: "es2022",
        conditions: ["workerd", "worker", "browser"],
        mainFields: ["module", "main"],
        external: ["cloudflare:*", "node:*"],
        logLevel: "silent",
        banner: {
          js: "import { createRequire } from 'node:module'; const require = createRequire('/worker.js');",
        },
      }),
    ),
  );
  const shared = {
    compatibilityDate: "2026-09-14",
    compatibilityFlags: ["nodejs_compat"],
    modules: true,
    // A test failure must not cause Google/CIMD/other external network traffic.
    outboundService: () => {
      throw new Error("External network requests are disabled in this fixture");
    },
  };
  const bindings = {
    APP_ORIGIN: appOrigin,
    MCP_ORIGIN: mcpOrigin,
    MCP_ENABLED: "true",
    MAINTENANCE_MODE: "false",
    APP_RELEASE: "mcp-workers-fixture",
  };
  const options = convertV4MiniflareOptions({
    // Model the public MCP origin, including Host. App HTTP calls below use
    // getWorker's service proxy and keep their independent application origin.
    upstream: mcpOrigin,
    log: new Log(LogLevel.NONE),
    handleStructuredLogs: () => {},
    telemetry: { enabled: false },
    workers: [
      {
        ...shared,
        compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
        name: "kaji-application-fixture",
        routes: [`${appOrigin}/*`],
        script: appBundle.outputFiles[0].text,
        bindings: {
          ...bindings,
          BETTER_AUTH_SECRET: fixtureSecret,
          GOOGLE_CLIENT_ID: "isolated-test-no-google-client",
          GOOGLE_CLIENT_SECRET: "isolated-test-no-google-secret",
          SIGNUP_ALLOWED_EMAILS: "fixture@example.com",
          VAPID_PUBLIC_KEY: "",
        },
        d1Databases: { DB: "isolated-mcp-db" },
        kvNamespaces: { OAUTH_KV: "isolated-mcp-oauth" },
        serviceBindings: {
          MCP_TEST_KV_BARRIER: async () => {
            const barrier = grantWriteBarrier;
            if (!barrier) throw new Error("No fixture grant-write barrier is armed");
            barrier.reached();
            await barrier.resume;
            return new Response(null, { status: 204 });
          },
        },
        durableObjects: { TEAM_REALTIME: { className: "TeamRealtime", useSQLite: true } },
      },
      {
        ...shared,
        name: "kaji-mcp-fixture",
        routes: [`${mcpOrigin}/*`],
        script: mcpBundle.outputFiles[0].text,
        bindings,
        serviceBindings: {
          KAJI_APPLICATION: { name: "kaji-application-fixture", entrypoint: "McpApplication" },
        },
      },
    ],
  });
  options.workers[0].config.exports = {
    ...options.workers[0].config.exports,
    McpApplication: { type: "worker" },
  };
  miniflare = new Miniflare(options);
  await miniflare.ready;
  app = await miniflare.getWorker("kaji-application-fixture");
  db = await miniflare.getD1Database("DB", "kaji-application-fixture");
  kv = await miniflare.getKVNamespace("OAUTH_KV", "kaji-application-fixture");
  const migrations = new URL("../../migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort()) {
    await db.batch(
      unstable_splitSqlQuery(await readFile(new URL(name, migrations), "utf8")).map((query) =>
        db.prepare(query),
      ),
    );
  }
}, 60_000);

afterAll(async () => {
  await miniflare?.dispose();
  if (directory) await rm(directory, { recursive: true, force: true });
}, 30_000);

async function identity() {
  const userId = randomUUID();
  const teamId = randomUUID();
  const sessionId = randomUUID();
  const sessionToken = createHash("sha256").update(randomBytes(32)).digest("base64url");
  const categoryId = randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO auth_user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)",
      )
      .bind(userId, "Workers fixture", `${userId}@example.com`, now, now),
    db
      .prepare(
        "INSERT INTO auth_session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        sessionId,
        sessionToken,
        userId,
        new Date(Date.now() + 3_600_000).toISOString(),
        now,
        now,
      ),
    db
      .prepare("INSERT INTO teams(id,name,todo_categories,created_at) VALUES(?,?,?,?)")
      .bind(
        teamId,
        "Workers fixture team",
        JSON.stringify([null, { id: categoryId, name: "買い物" }]),
        now,
      ),
    db
      .prepare("INSERT INTO team_members(team_id,user_id,role,created_at) VALUES(?,?,?,?)")
      .bind(teamId, userId, "owner", now),
  ]);
  const signature = createHmac("sha256", fixtureSecret).update(sessionToken).digest("base64");
  return {
    userId,
    teamId,
    sessionId,
    categoryId,
    cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${sessionToken}.${signature}`)}`,
  };
}

function hidden(html: string, name: string) {
  const encoded = html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1];
  if (!encoded) throw new Error(`Missing ${name} form field`);
  return encoded.replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
}

function cookies(response: WorkerResponse) {
  return response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .join("; ");
}

async function authorizationRequest(scopes: string[]) {
  const registration = await app.fetch(`${issuer}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Workers integration fixture",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(registration.status).toBe(201);
  const { client_id: clientId } = (await registration.json()) as { client_id: string };
  const verifier = createHash("sha256").update(randomBytes(32)).digest("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomUUID();
  const authorization = new URL(`${issuer}/authorize`);
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state,
    resource,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { authorization, clientId, verifier, state };
}

async function issueTokens(
  person: Awaited<ReturnType<typeof identity>>,
  scopes = ["todos:read", "todos:write", "offline_access"],
  tokenScopes?: string[],
) {
  const { authorization, clientId, verifier, state } = await authorizationRequest(scopes);
  const page = await app.fetch(authorization.href, { headers: { cookie: person.cookie } });
  expect(page.status).toBe(200);
  const handle = hidden(await page.text(), "handle");
  const form = new URLSearchParams({ handle, decision: "approve" });
  for (const scope of scopes) form.append("scope", scope);
  const consent = await app.fetch(`${issuer}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: `${person.cookie}; ${cookies(page)}`,
      origin: appOrigin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (consent.status !== 303) {
    const explanation = (await consent.text()).match(/<p>([^<]*)<\/p>/)?.[1];
    throw new Error(
      `Consent failed (HTTP ${consent.status}): ${explanation ?? "no application message"}`,
    );
  }
  const target = new URL(consent.headers.get("location")!);
  expect(target.origin + target.pathname).toBe(redirectUri);
  expect(target.searchParams.get("state") === state).toBe(true);
  const code = target.searchParams.get("code");
  if (!code) throw new Error("Missing OAuth authorization code");
  const exchange = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    client_id: clientId,
    resource,
  });
  if (tokenScopes) exchange.set("scope", tokenScopes.join(" "));
  const tokenResponse = await app.fetch(`${issuer}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: exchange.toString(),
  });
  expect(tokenResponse.status).toBe(200);
  const tokens = (await tokenResponse.json()) as Tokens;
  expect(typeof tokens.access_token).toBe("string");
  const connection = await db
    .prepare("SELECT id FROM mcp_connections WHERE user_id=? AND client_id=?")
    .bind(person.userId, clientId)
    .first<{ id: string }>();
  if (!connection) throw new Error("Missing local connection");
  return { ...tokens, clientId, connectionId: connection.id, exchange };
}

async function rpcResponse(
  token: string | undefined,
  method: string,
  params: Record<string, unknown> = {},
) {
  return miniflare.dispatchFetch(resource, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: new URL(mcpOrigin).host,
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++messageId, method, params }),
  });
}

async function rpc(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<RpcMessage> {
  const response = await rpcResponse(token, method, params);
  expect(response.status).toBe(200);
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const events = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as RpcMessage);
    const event = events.find((item) => item.id === messageId);
    if (!event) throw new Error("Missing MCP response event");
    return event;
  }
  return (await response.json()) as RpcMessage;
}

async function call(token: string, name: string, args: Record<string, unknown> = {}) {
  return rpc(token, "tools/call", { name, arguments: args });
}

function revokeToken(token: string, clientId: string, tokenType: string, fault?: string) {
  return app.fetch(`${issuer}/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(fault ? { "x-fixture-kv-fault": fault } : {}),
    },
    body: new URLSearchParams({
      token,
      client_id: clientId,
      token_type_hint: tokenType,
    }).toString(),
  });
}

function refreshToken(token: string, clientId: string, fault?: string) {
  return app.fetch(`${issuer}/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(fault ? { "x-fixture-kv-fault": fault } : {}),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token,
      client_id: clientId,
      resource,
    }).toString(),
  });
}

function revokedAt(connectionId: string) {
  return db
    .prepare("SELECT revoked_at FROM mcp_connections WHERE id=?")
    .bind(connectionId)
    .first<string | null>("revoked_at");
}

async function expectRefreshDenied(token: string, clientId: string) {
  const response = await refreshToken(token, clientId);
  expect(response.status).toBe(400);
  expect(((await response.json()) as { error: string }).error).toBe("invalid_grant");
}

async function createRetainedTodo(token: string) {
  const added = await call(token, "add_todo", { name: "Must remain after revocation" });
  expect(added.result?.isError).not.toBe(true);
  const item = added.result?.structuredContent?.item as { id: string; name: string };
  expect(typeof item.id).toBe("string");
  return { id: item.id, name: item.name };
}

async function expectBusinessAccessDenied(token: string, itemId: string) {
  for (const [name, args] of [
    ["list_todos", {}],
    ["add_todo", { name: "Must not be added after revocation" }],
    ["complete_todo", { itemId }],
  ] as const) {
    expect(
      (await rpcResponse(token, "tools/call", { name, arguments: args })).status,
      `${name} must reject the revoked connection`,
    ).toBe(401);
  }
}

it("accepts native browser consent, revocation and login forms without rewriting their Origin", async () => {
  const person = await identity();
  const { authorization, clientId } = await authorizationRequest(["todos:read"]);
  const browser = await chromium.launch({
    proxy: { server: "http://127.0.0.1:9" },
    args: ["--proxy-bypass-list=<-loopback>"],
  });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const separator = person.cookie.indexOf("=");
    await context.addCookies([
      {
        name: person.cookie.slice(0, separator),
        value: person.cookie.slice(separator + 1),
        url: appOrigin,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    const posts: { path: string; origin: string | null; status: number }[] = [];
    const externalReferrers: (string | null)[] = [];
    let consentRequest: { headers: Record<string, string>; body: string } | undefined;
    let internalReferrerMatchesAuthorization = false;
    let bridgeFailed = false;
    let unexpectedRequests = 0;
    // As in mcp-consent-csp.spec.ts, intercept every redirect hop. The dead proxy
    // and the Worker's outboundService prevent any real Google/client traffic.
    session.on("Fetch.requestPaused", async ({ requestId, request }) => {
      try {
        const url = new URL(request.url);
        const headers = new Headers(request.headers);
        let response: Response | WorkerResponse;
        if (url.origin === appOrigin) {
          // Forward the browser's actual headers and body, including Origin and
          // cookies. Never replace the production browserPost check with a stub.
          response = await app.fetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.postData,
            redirect: "manual",
          });
          if (request.method === "POST") {
            posts.push({
              path: url.pathname,
              origin: headers.get("origin"),
              status: response.status,
            });
            if (url.pathname === "/api/mcp/oauth/authorize") {
              consentRequest = { headers: request.headers, body: request.postData! };
              // Compare only: do not print a Referer carrying OAuth query values.
              internalReferrerMatchesAuthorization = headers.get("referer") === authorization.href;
            }
          }
        } else if (
          url.origin + url.pathname === redirectUri ||
          url.origin === "https://accounts.google.com"
        ) {
          externalReferrers.push(headers.get("referer"));
          response = new Response("Local OAuth destination", {
            headers: { "Content-Type": "text/plain", "Referrer-Policy": "no-referrer" },
          });
        } else {
          unexpectedRequests += 1;
          await session.send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
          return;
        }
        await session.send("Fetch.fulfillRequest", {
          requestId,
          responseCode: response.status,
          responseHeaders: [
            ...[...response.headers]
              .filter(([name]) => name.toLowerCase() !== "set-cookie")
              .map(([name, value]) => ({ name, value })),
            ...response.headers.getSetCookie().map((value) => ({ name: "Set-Cookie", value })),
          ],
          body: Buffer.from(await response.arrayBuffer()).toString("base64"),
        });
      } catch {
        bridgeFailed = true;
        await session.send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
      }
    });
    await session.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });

    await page.goto(authorization.href);
    const approved = page.waitForResponse(
      (response) =>
        response.url() === `${issuer}/authorize` && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "選んだ操作を許可" }).click();
    expect((await approved).status(), JSON.stringify(posts)).toBe(303);
    await page.getByText("Local OAuth destination").waitFor();
    expect(internalReferrerMatchesAuthorization).toBe(true);
    expect(new URL(page.url()).searchParams.has("code")).toBe(true);
    const connection = await db
      .prepare("SELECT id FROM mcp_connections WHERE user_id=? AND client_id=?")
      .bind(person.userId, clientId)
      .first<{ id: string }>();
    expect(connection).not.toBeNull();
    expect(
      (
        await app.fetch(`${issuer}/authorize`, {
          method: "POST",
          headers: consentRequest!.headers,
          body: consentRequest!.body,
          redirect: "manual",
        })
      ).status,
    ).toBe(400);

    await page.goto(`${appOrigin}/api/mcp/connections`);
    await page.getByRole("button", { name: "連携を解除", exact: true }).click();
    await page.getByText("解除済み", { exact: false }).waitFor();
    expect(await revokedAt(connection!.id)).not.toBeNull();

    await context.clearCookies();
    await page.goto(authorization.href);
    await page.getByRole("button", { name: "Google でログイン" }).click();
    await page.getByText("Local OAuth destination").waitFor();
    expect(posts).toEqual(
      ["/api/mcp/oauth/authorize", "/api/mcp/connections/revoke", "/api/mcp/oauth/login"].map(
        (path) => ({ path, origin: appOrigin, status: 303 }),
      ),
    );
    expect(externalReferrers).toEqual([null, null]);
    expect(bridgeFailed).toBe(false);
    expect(unexpectedRequests).toBe(0);
  } finally {
    await browser.close();
  }
}, 60_000);

it("uses real OAuth, RPC and D1 for list/add/complete, then rejects the revoked grant", async () => {
  const discovery = await app.fetch(
    `${appOrigin}/.well-known/oauth-authorization-server/api/mcp/oauth`,
  );
  expect(discovery.status).toBe(200);
  expect(await discovery.json()).toMatchObject({
    issuer,
    client_id_metadata_document_supported: true,
  });
  const person = await identity();
  const other = await identity();
  const otherTodo = randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO todo_items(id,team_id,name,sort_key,created_at,updated_at) VALUES(?,?,?,1,?,?)",
    )
    .bind(otherTodo, other.teamId, "Other team fixture", now, now)
    .run();
  const token = await issueTokens(person);
  const initialized = await rpc(token.access_token, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "local-integration", version: "1" },
  });
  expect(initialized.error).toBeUndefined();
  const tools = await rpc(token.access_token, "tools/list");
  expect(
    ((tools.result?.tools ?? []) as { name: string }[]).map((tool) => tool.name).sort(),
  ).toEqual(["add_todo", "complete_todo", "list_todos"]);
  const listed = await call(token.access_token, "list_todos");
  expect(listed.result?.structuredContent).toEqual({
    items: [],
    categories: [null, { id: person.categoryId, name: "買い物" }],
  });
  const added = await call(token.access_token, "add_todo", {
    name: "MCP integration milk",
    notes: "Isolated fixture",
    categoryId: person.categoryId,
  });
  expect(added.result?.isError).not.toBe(true);
  const item = added.result?.structuredContent?.item as { id: string; name: string };
  expect(item.name).toBe("MCP integration milk");
  expect(
    await db.prepare("SELECT team_id FROM todo_items WHERE id=?").bind(item.id).first("team_id"),
  ).toBe(person.teamId);
  expect(
    (await call(token.access_token, "complete_todo", { itemId: otherTodo })).result?.isError,
  ).toBe(true);
  expect(
    await db
      .prepare("SELECT count(*) FROM todo_items WHERE id=?")
      .bind(otherTodo)
      .first("count(*)"),
  ).toBe(1);
  const completed = await call(token.access_token, "complete_todo", { itemId: item.id });
  expect(completed.result?.structuredContent).toEqual({ id: item.id, completed: true });
  expect(
    await db.prepare("SELECT count(*) FROM todo_items WHERE id=?").bind(item.id).first("count(*)"),
  ).toBe(0);

  const management = await app.fetch(`${appOrigin}/api/mcp/connections`, {
    headers: { cookie: person.cookie },
  });
  expect(management.status).toBe(200);
  const managementHtml = await management.text();
  const revoke = await app.fetch(`${appOrigin}/api/mcp/connections/revoke`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: person.cookie,
      origin: appOrigin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      connectionId: hidden(managementHtml, "connectionId"),
      handle: hidden(managementHtml, "handle"),
    }).toString(),
  });
  expect(revoke.status).toBe(303);
  expect((await rpcResponse(token.access_token, "tools/list")).status).toBe(401);
  const refresh = await app.fetch(`${issuer}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token!,
      client_id: token.clientId,
      resource,
    }).toString(),
  });
  expect(refresh.status).toBe(400);
  expect(((await refresh.json()) as { error: string }).error).toBe("invalid_grant");
  const reused = await app.fetch(`${issuer}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: token.exchange.toString(),
  });
  expect(reused.status).toBe(400);
}, 30_000);

it("uses the actual token scopes and rejects writes for a read-only authorization", async () => {
  const person = await identity();
  const token = await issueTokens(person, ["todos:read"]);
  expect((await call(token.access_token, "list_todos")).result?.isError).not.toBe(true);
  const forbidden = await rpcResponse(token.access_token, "tools/call", {
    name: "add_todo",
    arguments: { name: "Must not be inserted" },
  });
  expect(forbidden.status).toBe(403);
  expect(forbidden.headers.get("www-authenticate")?.includes("insufficient_scope")).toBe(true);
  expect(
    await db
      .prepare("SELECT count(*) FROM todo_items WHERE team_id=?")
      .bind(person.teamId)
      .first("count(*)"),
  ).toBe(0);
}, 30_000);

it("rejects writes when a token narrows a grant that permits writing", async () => {
  const person = await identity();
  const token = await issueTokens(person, ["todos:read", "todos:write"], ["todos:read"]);
  expect(token.scope.split(" ")).toEqual(["todos:read"]);
  const grantedScopes = await db
    .prepare("SELECT scopes FROM mcp_connections WHERE id=?")
    .bind(token.connectionId)
    .first<string>("scopes");
  expect(JSON.parse(grantedScopes!)).toEqual(["todos:read", "todos:write"]);
  expect((await call(token.access_token, "list_todos")).result?.isError).not.toBe(true);
  expect(
    (
      await rpcResponse(token.access_token, "tools/call", {
        name: "add_todo",
        arguments: { name: "Must not be inserted" },
      })
    ).status,
  ).toBe(403);
  expect(
    await db
      .prepare("SELECT count(*) FROM todo_items WHERE team_id=?")
      .bind(person.teamId)
      .first("count(*)"),
  ).toBe(0);
}, 30_000);

it("refuses forged public IDs and exposes no HTTP forwarding route for the named RPC", async () => {
  const person = await identity();
  const token = await issueTokens(person, ["todos:read", "todos:write"]);
  expect((await rpcResponse(undefined, "tools/list")).status).toBe(401);
  expect((await rpcResponse("invalid-fixture-token", "tools/list")).status).toBe(401);
  const injected = await call(token.access_token, "add_todo", {
    name: "Must not be inserted",
    userId: person.userId,
    teamId: person.teamId,
  });
  expect(Boolean(injected.error || injected.result?.isError)).toBe(true);
  for (const path of ["/invoke", "/api/mcp/invoke", "/api/mcp/validateToken"]) {
    const response = await app.fetch(`${appOrigin}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": person.userId,
        "x-team-id": person.teamId,
      },
      body: JSON.stringify({ tool: "add_todo", arguments: { name: "Must not be inserted" } }),
    });
    expect(response.status).toBe(404);
  }
  expect(
    await db
      .prepare("SELECT count(*) FROM todo_items WHERE team_id=?")
      .bind(person.teamId)
      .first("count(*)"),
  ).toBe(0);
}, 30_000);

it("rechecks D1 revocation, connection expiry and current membership independently of KV", async () => {
  const person = await identity();
  const token = await issueTokens(person, ["todos:read", "todos:write", "offline_access"]);
  await db
    .prepare("UPDATE mcp_connections SET revoked_at=? WHERE id=?")
    .bind(new Date().toISOString(), token.connectionId)
    .run();
  expect((await rpcResponse(token.access_token, "tools/list")).status).toBe(401);

  const expiredPerson = await identity();
  const expired = await issueTokens(expiredPerson, ["todos:read"]);
  await db
    .prepare("UPDATE mcp_connections SET created_at=?,expires_at=? WHERE id=?")
    .bind("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", expired.connectionId)
    .run();
  expect((await rpcResponse(expired.access_token, "tools/list")).status).toBe(401);

  const departedPerson = await identity();
  const departed = await issueTokens(departedPerson, ["todos:read"]);
  await db.prepare("DELETE FROM team_members WHERE user_id=?").bind(departedPerson.userId).run();
  expect((await rpcResponse(departed.access_token, "tools/list")).status).toBe(401);
}, 30_000);

it.each(["access_token", "refresh_token"] as const)(
  "RFC 7009 revokes the D1 connection for a genuine %s, even with the wrong hint",
  async (type) => {
    const person = await identity();
    const token = await issueTokens(person);
    const independent = await issueTokens(person);
    // Hint fallback must still verify the actual credential before invoking D1.
    const hint = type === "access_token" ? "refresh_token" : "access_token";
    const response = await revokeToken(token[type]!, token.clientId, hint);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(await revokedAt(token.connectionId)).not.toBeNull();
    expect((await rpcResponse(token.access_token, "tools/list")).status).toBe(401);
    await expectRefreshDenied(token.refresh_token!, token.clientId);
    expect(await revokedAt(independent.connectionId)).toBeNull();
    expect((await call(independent.access_token, "list_todos")).result?.isError).not.toBe(true);
  },
  30_000,
);

it.each([
  ["access_token", "other-client"],
  ["refresh_token", "other-client"],
  ["access_token", "forged-secret"],
  ["refresh_token", "forged-secret"],
] as const)(
  "RFC 7009 leaves D1 and usable tokens unchanged for %s / %s",
  async (type, invalidity) => {
    const person = await identity();
    const token = await issueTokens(person);
    const other = await issueTokens(await identity());
    const genuine = token[type]!;
    const attempted =
      invalidity === "forged-secret"
        ? `${genuine.split(":").slice(0, 2).join(":")}:${randomUUID()}`
        : genuine;
    const clientId = invalidity === "other-client" ? other.clientId : token.clientId;
    const response = await revokeToken(attempted, clientId, type);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(await revokedAt(token.connectionId)).toBeNull();
    expect(await revokedAt(other.connectionId)).toBeNull();
    expect((await call(token.access_token, "list_todos")).result?.isError).not.toBe(true);
    const refreshed = await refreshToken(token.refresh_token!, token.clientId);
    expect(refreshed.status).toBe(200);
    expect((await call(other.access_token, "list_todos")).result?.isError).not.toBe(true);
  },
  30_000,
);

it("RFC 7009 verifies and revokes the previously rotated refresh credential", async () => {
  const token = await issueTokens(await identity());
  const refreshed = await refreshToken(token.refresh_token!, token.clientId);
  expect(refreshed.status).toBe(200);
  const next = (await refreshed.json()) as Tokens;
  const response = await revokeToken(token.refresh_token!, token.clientId, "refresh_token");
  expect(response.status).toBe(200);
  expect(await revokedAt(token.connectionId)).not.toBeNull();
  expect((await rpcResponse(next.access_token, "tools/list")).status).toBe(401);
  await expectRefreshDenied(next.refresh_token!, token.clientId);
}, 30_000);

it.each(["access_token", "refresh_token"] as const)(
  "RFC 7009 returns 503 without deleting KV when the D1 revoke of %s fails",
  async (type) => {
    const token = await issueTokens(await identity());
    const tokenPrefix = `token:${token.access_token.split(":").slice(0, 2).join(":")}:`;
    const grantKey = `grant:${token.access_token.split(":").slice(0, 2).join(":")}`;
    const before = (await kv.list({ prefix: tokenPrefix })).keys.map(({ name }) => name);
    expect(before.length).toBeGreaterThan(0);
    await db
      .prepare(
        `CREATE TRIGGER fixture_revoke_failure BEFORE UPDATE OF revoked_at ON mcp_connections
         BEGIN SELECT RAISE(ABORT, 'Fixture D1 revocation failure'); END`,
      )
      .run();
    try {
      const response = await revokeToken(token[type]!, token.clientId, type);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "temporarily_unavailable",
        error_description: expect.any(String),
      });
      expect(await revokedAt(token.connectionId)).toBeNull();
      const after = (await kv.list({ prefix: tokenPrefix })).keys.map(({ name }) => name);
      expect(after).toEqual(before);
      expect((await kv.get(grantKey)) !== null).toBe(true);
      expect((await call(token.access_token, "list_todos")).result?.isError).not.toBe(true);
    } finally {
      await db.prepare("DROP TRIGGER fixture_revoke_failure").run();
    }
    expect((await revokeToken(token[type]!, token.clientId, type)).status).toBe(200);
    expect((await rpcResponse(token.access_token, "tools/list")).status).toBe(401);
  },
  30_000,
);

it.each(["access_token", "refresh_token"] as const)(
  "RFC 7009 keeps %s unusable after D1 commits but KV deletion fails",
  async (type) => {
    const person = await identity();
    const token = await issueTokens(person);
    const retained = await createRetainedTodo(token.access_token);
    const tokenPrefix = `token:${token.access_token.split(":").slice(0, 2).join(":")}:`;
    const before = (await kv.list({ prefix: tokenPrefix })).keys.map(({ name }) => name);
    expect(before.length).toBeGreaterThan(0);
    const response = await revokeToken(token[type]!, token.clientId, type, "delete-failure");
    expect(response.status).toBe(503);
    expect(await revokedAt(token.connectionId)).not.toBeNull();
    // The credential really remains in KV: rejection must come from D1, not
    // from successful token deletion or a mocked resource-server response.
    expect((await kv.list({ prefix: tokenPrefix })).keys.map(({ name }) => name)).toEqual(before);
    expect((await rpcResponse(token.access_token, "tools/list")).status).toBe(401);
    await expectBusinessAccessDenied(token.access_token, retained.id);
    await expectRefreshDenied(token.refresh_token!, token.clientId);
    expect(
      (await db.prepare("SELECT id,name FROM todo_items WHERE team_id=?").bind(person.teamId).all())
        .results,
    ).toEqual([retained]);
  },
  30_000,
);

it.each(["access_token", "refresh_token"] as const)(
  "a refresh saving after RFC 7009 %s revocation cannot restore business access",
  async (type) => {
    const person = await identity();
    const token = await issueTokens(person);
    const retained = await createRetainedTodo(token.access_token);
    let reached!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      reached = resolve;
    });
    grantWriteBarrier = {
      reached,
      resume: new Promise<void>((resolve) => {
        resume = resolve;
      }),
    };
    // Stop after the actual refresh callback's D1 checks but before its KV
    // grant/token writes. Revocation completes while the old snapshot is held.
    const inFlight = refreshToken(token.refresh_token!, token.clientId, "pause-grant-write");
    try {
      await paused;
      expect((await revokeToken(token[type]!, token.clientId, type)).status).toBe(200);
      expect(await revokedAt(token.connectionId)).not.toBeNull();
    } finally {
      resume();
      grantWriteBarrier = undefined;
    }
    const refreshed = await inFlight;
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as Tokens;
    expect(typeof next.access_token).toBe("string");
    const tokenPrefix = `token:${next.access_token.split(":").slice(0, 2).join(":")}:`;
    expect((await kv.list({ prefix: tokenPrefix })).keys.length).toBeGreaterThan(0);
    expect((await rpcResponse(next.access_token, "tools/list")).status).toBe(401);
    await expectBusinessAccessDenied(next.access_token, retained.id);
    await expectRefreshDenied(next.refresh_token!, token.clientId);
    expect(
      (await db.prepare("SELECT id,name FROM todo_items WHERE team_id=?").bind(person.teamId).all())
        .results,
    ).toEqual([retained]);
  },
  30_000,
);
