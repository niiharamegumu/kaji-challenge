import {
  AuthorizationError,
  CimdFetchError,
  OAuthAuthorizationServer,
  OAuthError,
  type AuthRequest,
  type OAuthHelpers,
  type TokenExchangeCallbackOptions,
  type TokenRevocationCallbackOptions,
} from "@cloudflare/workers-oauth-provider";
import { McpTokenPropsSchema, mcpScopes } from "../../contracts/mcp";
import { AppError } from "../domain/errors";
import { D1McpRepository } from "../infrastructure/mcp-repository";
import { createDatabase } from "../infrastructure/database";
import { createRuntime, type RuntimeBindings } from "./runtime.server";
import {
  mcpConnectionsPage,
  mcpConsentPage,
  mcpErrorPage,
  mcpHtml,
  mcpLoginPage,
} from "./mcp-pages";

const basePath = "/api/mcp/oauth";
const authorizePath = `${basePath}/authorize`;
const supportedScopes: readonly string[] = [...mcpScopes, "offline_access"];
const accessTokenTTL = 15 * 60;
const connectionTTL = 30 * 24 * 60 * 60;
const consentTTL = 10 * 60;

function mcpResource(bindings: RuntimeBindings) {
  return `${new URL(bindings.MCP_ORIGIN).origin}/mcp`;
}

function invalidGrant(): never {
  throw new OAuthError("invalid_grant", { description: "The authorization is no longer valid." });
}

async function tokenExchange(options: TokenExchangeCallbackOptions<RuntimeBindings>) {
  try {
    if (options.env.MCP_ENABLED !== "true" || options.env.MAINTENANCE_MODE === "true")
      throw new OAuthError("temporarily_unavailable", {
        description: "Authorization is unavailable.",
        statusCode: 503,
      });
    const props = McpTokenPropsSchema.safeParse(options.props);
    if (!props.success || !["authorization_code", "refresh_token"].includes(options.grantType))
      invalidGrant();
    const { db, repository } = createDatabase(options.env.DB);
    const connections = new D1McpRepository(db);
    const connection = await connections.getConnection(props.data.connectionId);
    const now = new Date().toISOString();
    if (
      !connection ||
      connection.revokedAt ||
      connection.expiresAt <= now ||
      connection.userId !== options.userId ||
      connection.clientId !== options.clientId ||
      options.subjectClientId !== options.clientId ||
      connection.resource !== options.resource ||
      options.resource !== mcpResource(options.env) ||
      !options.scope.every((scope) => connection.scopes.includes(scope)) ||
      !options.requestedScope.every(
        (scope) => options.scope.includes(scope) && supportedScopes.includes(scope),
      )
    )
      invalidGrant();
    const memberships = await repository.ListMembershipsByUserID(options.userId);
    if (memberships.length !== 1 || !["owner", "member"].includes(memberships[0].Role))
      invalidGrant();
    if (options.grantType === "authorization_code") {
      if (
        !(await connections.bindGrant(
          connection.id,
          options.userId,
          options.clientId,
          options.resource,
          options.grantId,
          now,
        ))
      )
        invalidGrant();
    } else if (
      connection.grantId !== options.grantId ||
      !connection.scopes.includes("offline_access")
    )
      invalidGrant();
    const remainingSeconds = Math.floor((Date.parse(connection.expiresAt) - Date.now()) / 1000);
    if (remainingSeconds <= 0) invalidGrant();
    return {
      accessTokenTTL: Math.min(accessTokenTTL, remainingSeconds),
      // The provider applies this only on code exchange. Do not introduce a
      // rolling refresh lifetime, and do not outlive the original D1 consent.
      refreshTokenTTL:
        connection.scopes.includes("offline_access") && remainingSeconds >= 60
          ? Math.min(connectionTTL, remainingSeconds)
          : 0,
    };
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    // Database failures must never mint tokens or expose SQL, credentials or user data.
    throw new OAuthError("temporarily_unavailable", {
      description: "Authorization is unavailable.",
      statusCode: 503,
    });
  }
}

async function tokenRevocation(options: TokenRevocationCallbackOptions<RuntimeBindings>) {
  try {
    if (options.env.MCP_ENABLED !== "true" || options.env.MAINTENANCE_MODE === "true")
      throw new Error("Revocation is unavailable");
    const { db } = createDatabase(options.env.DB);
    // The provider calls this only after verifying the token hash and its client.
    // Revoke the whole connection even for an access-token revocation, so a
    // concurrent refresh or stale KV replica cannot restore application access.
    const revoked = await new D1McpRepository(db).revokeGrantConnection(
      options.userId,
      options.clientId,
      options.grantId,
      new Date().toISOString(),
    );
    if (!revoked) throw new Error("Connection does not match the verified grant");
  } catch {
    // Abort before any provider KV deletion; never expose a SQL or token detail.
    throw new OAuthError("temporarily_unavailable", {
      description: "Revocation is unavailable.",
      statusCode: 503,
    });
  }
}

export function createMcpAuthorizationServer(bindings: RuntimeBindings) {
  const issuer = `${new URL(bindings.APP_ORIGIN).origin}${basePath}`;
  return new OAuthAuthorizationServer<RuntimeBindings>({
    issuer,
    authorizeEndpoint: `${issuer}/authorize`,
    tokenEndpoint: `${issuer}/token`,
    clientRegistrationEndpoint: `${issuer}/register`,
    resources: [mcpResource(bindings)],
    scopesSupported: [...supportedScopes],
    accessTokenTTL,
    refreshTokenTTL: connectionTTL,
    allowTokenExchangeGrant: false,
    allowPrivateUseRedirectUris: false,
    clientIdMetadataDocumentEnabled: true,
    tokenExchangeCallback: tokenExchange,
    tokenRevocationCallback: tokenRevocation,
    onError({ code, status }) {
      // Provider descriptions and diagnostic fields may include request values.
      // Record only protocol classification, never the request or its credentials.
      console.warn(JSON.stringify({ event: "mcp_oauth_error", code, status }));
    },
  });
}

export function isMcpHttpPath(path: string) {
  return (
    path === "/api/mcp" ||
    path.startsWith("/api/mcp/") ||
    path === "/.well-known/oauth-authorization-server/api/mcp/oauth"
  );
}

function validateRequest(request: AuthRequest, bindings: RuntimeBindings) {
  // Chromium cannot express an IPv6-literal host in form-action. Reject before
  // sign-in/consent rather than create a grant whose callback the browser blocks.
  if (new URL(request.redirectUri).hostname.startsWith("["))
    throw new AppError(
      400,
      "invalid_request",
      "IPv6 アドレスの戻り先には対応していません。localhost、127.0.0.1、またはホスト名の戻り先で接続を開始してください。",
    );
  if (request.resource !== mcpResource(bindings))
    throw new AuthorizationError("invalid_target", {
      description: "The requested resource is not supported.",
    });
  if (
    request.responseType !== "code" ||
    request.codeChallengeMethod !== "S256" ||
    !request.codeChallenge ||
    !/^[A-Za-z0-9_-]{43}$/.test(request.codeChallenge)
  )
    throw new AuthorizationError("invalid_request", { description: "S256 PKCE is required." });
  if (
    request.scope.some((scope) => !supportedScopes.includes(scope)) ||
    !request.scope.some((scope) => mcpScopes.some((supported) => supported === scope))
  )
    throw new AuthorizationError("invalid_scope", {
      description: "Select a supported ToDo permission.",
    });
}

async function hashClaim(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function browserPost(request: Request, origin: string) {
  if (
    request.headers.get("origin") !== origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AppError(403, "forbidden", "この送信元からは操作できません。");
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))
    throw new AppError(400, "invalid_request", "フォームを開き直してください。");
}

async function formData(request: Request) {
  // This limit applies only to our browser forms, never to provider-owned protocol endpoints.
  const reader = request.body?.getReader();
  if (!reader) return new URLSearchParams();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) {
        await reader.cancel();
        throw new AppError(413, "invalid_request", "フォームが大きすぎます。");
      }
      text += decoder.decode(value, { stream: true });
    }
    return new URLSearchParams(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

function field(form: URLSearchParams, name: string) {
  const values = form.getAll(name);
  if (values.length !== 1 || !values[0] || values[0].length > 8192)
    throw new AppError(400, "invalid_request", "フォームを開き直してください。");
  return values[0];
}

function redirect(location: string, initialHeaders?: HeadersInit) {
  const headers = new Headers(initialHeaders);
  headers.set("Location", location);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(null, { status: 303, headers });
}

async function login(request: Request, bindings: RuntimeBindings, oauth: OAuthHelpers) {
  const origin = new URL(bindings.APP_ORIGIN).origin;
  browserPost(request, origin);
  const form = await formData(request);
  const authorizationUrl = new URL(field(form, "authorizationUrl"));
  if (
    authorizationUrl.origin !== origin ||
    authorizationUrl.pathname !== authorizePath ||
    authorizationUrl.username ||
    authorizationUrl.password ||
    authorizationUrl.hash
  )
    throw new AppError(400, "invalid_request", "ログインの戻り先が不正です。");
  validateRequest(await oauth.parseAuthRequest(new Request(authorizationUrl)), bindings);
  const runtime = createRuntime(bindings);
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("Content-Length");
  const response = await runtime.auth.handler(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: "google",
        callbackURL: authorizationUrl.href,
        errorCallbackURL: `${origin}${basePath}/error`,
      }),
    }),
  );
  if (!response.ok)
    return mcpErrorPage(
      "ログインを開始できませんでした。もう一度接続を開始してください。",
      response.status >= 500 ? 503 : 400,
    );
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("url" in body) || typeof body.url !== "string")
    throw new Error("Missing social login redirect");
  const target = new URL(body.url);
  if (target.protocol !== "https:" || target.hostname !== "accounts.google.com")
    throw new Error("Invalid social login redirect");
  const outgoing = new Headers();
  for (const cookie of response.headers.getSetCookie()) outgoing.append("Set-Cookie", cookie);
  return redirect(target.href, outgoing);
}

async function authorize(request: Request, bindings: RuntimeBindings, oauth: OAuthHelpers) {
  const runtime = createRuntime(bindings);
  const connections = new D1McpRepository(runtime.db);
  if (request.method === "POST") browserPost(request, new URL(bindings.APP_ORIGIN).origin);
  const session = await runtime.auth.api.getSession({ headers: request.headers });
  if (request.method === "GET") {
    const authorization = await oauth.parseAuthRequest(request);
    validateRequest(authorization, bindings);
    if (!session)
      return mcpHtml(mcpLoginPage(request.url), 200, undefined, "https://accounts.google.com");
    const memberships = await runtime.repository.ListMembershipsByUserID(session.user.id);
    if (memberships.length !== 1 || !["owner", "member"].includes(memberships[0].Role))
      throw new AppError(403, "forbidden", "チームへの所属が必要です。");
    const details = await oauth.describeConsent(authorization);
    const consent = await oauth.beginConsent(authorization);
    await connections.createConsentClaim({
      handleHash: await hashClaim(`consent:${consent.handle}`),
      userId: session.user.id,
      sessionId: session.session.id,
      expiresAt: new Date(Date.now() + consentTTL * 1000).toISOString(),
    });
    return mcpHtml(
      mcpConsentPage(details, consent.handle, session.user.name, memberships[0].TeamName),
      200,
      consent.headers,
      authorization.redirectUri,
    );
  }
  if (!session) throw new AppError(401, "unauthorized", "ログインし直して接続を開始してください。");
  const form = await formData(request);
  const handle = field(form, "handle");
  const decision = field(form, "decision");
  if (!["approve", "deny"].includes(decision))
    throw new AppError(400, "invalid_request", "許可または拒否を選んでください。");
  if (
    !(await connections.consumeConsentClaim(
      await hashClaim(`consent:${handle}`),
      session.user.id,
      session.session.id,
      new Date().toISOString(),
    ))
  )
    throw new AppError(
      400,
      "invalid_request",
      "この同意は期限切れ、使用済み、または別のログインで開かれています。",
    );
  if (decision === "deny") {
    const denied = await oauth.denyConsent(request, handle);
    return redirect(denied.redirectTo, denied.headers);
  }
  const memberships = await runtime.repository.ListMembershipsByUserID(session.user.id);
  if (memberships.length !== 1 || !["owner", "member"].includes(memberships[0].Role))
    throw new AppError(403, "forbidden", "チームへの所属が必要です。");
  // Read the provider-stored request before selecting scopes: its helper deliberately
  // permits adding supported scopes, whereas this UI only allows reducing the request.
  const approved = await oauth.approveConsent(request, handle);
  validateRequest(approved.request, bindings);
  const scope = [...new Set(form.getAll("scope"))];
  if (
    scope.some((item) => !approved.request.scope.includes(item)) ||
    !scope.some((item) => mcpScopes.some((supported) => supported === item))
  )
    throw new AppError(400, "invalid_scope", "要求された ToDo 操作を選んでください。");
  const details = await oauth.describeConsent(approved.request);
  const id = crypto.randomUUID();
  const now = new Date();
  await connections.createConnection({
    id,
    userId: session.user.id,
    clientId: approved.request.clientId,
    clientName: details.clientName,
    resource: mcpResource(bindings),
    scopes: scope,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + connectionTTL * 1000).toISOString(),
  });
  const completed = await oauth.completeAuthorization({
    request: approved.request,
    userId: session.user.id,
    metadata: {},
    scope,
    props: { connectionId: id },
    revokeExistingGrants: false,
  });
  return redirect(completed.redirectTo, approved.headers);
}

async function manageConnections(request: Request, bindings: RuntimeBindings, oauth: OAuthHelpers) {
  if (request.method === "POST") browserPost(request, new URL(bindings.APP_ORIGIN).origin);
  const runtime = createRuntime(bindings);
  const session = await runtime.auth.api.getSession({ headers: request.headers });
  if (!session)
    throw new AppError(
      401,
      "unauthorized",
      "KajiChalle にログインしてから連携の管理を開いてください。",
    );
  const connections = new D1McpRepository(runtime.db);
  const now = new Date().toISOString();
  if (request.method === "GET") {
    const rows = [];
    for (const connection of await connections.listConnections(session.user.id)) {
      const handle = crypto.randomUUID();
      await connections.createConsentClaim({
        handleHash: await hashClaim(`revoke:${connection.id}:${handle}`),
        userId: session.user.id,
        sessionId: session.session.id,
        expiresAt: new Date(Date.now() + consentTTL * 1000).toISOString(),
      });
      rows.push({ connection, handle });
    }
    return mcpHtml(mcpConnectionsPage(rows, now));
  }
  const form = await formData(request);
  const id = field(form, "connectionId");
  const handle = field(form, "handle");
  if (
    !(await connections.consumeConsentClaim(
      await hashClaim(`revoke:${id}:${handle}`),
      session.user.id,
      session.session.id,
      now,
    ))
  )
    throw new AppError(400, "invalid_request", "連携の管理を開き直してください。");
  // D1 revocation takes effect before eventual KV revocation. A failed KV attempt
  // can be retried from the management page without re-enabling the connection.
  const connection = await connections.revokeConnection(id, session.user.id, now);
  if (!connection) throw new AppError(404, "not_found", "連携が見つかりません。");
  if (connection.grantId) {
    try {
      await oauth.revokeGrant(connection.grantId, session.user.id);
    } catch {
      return mcpErrorPage(
        "連携からのアクセスは停止しました。トークンの失効処理は連携の管理から再実行してください。",
        503,
      );
    }
  }
  return redirect("/api/mcp/connections");
}

export async function handleMcpHttp(
  request: Request,
  bindings: RuntimeBindings,
  ctx: ExecutionContext,
): Promise<Response> {
  if (bindings.MCP_ENABLED !== "true") return new Response("Not found", { status: 404 });
  if (bindings.MAINTENANCE_MODE === "true") return mcpErrorPage("メンテナンス中です。", 503);
  try {
    const url = new URL(request.url);
    if (url.origin !== new URL(bindings.APP_ORIGIN).origin)
      return new Response("Not found", { status: 404 });
    const server = createMcpAuthorizationServer(bindings);
    const oauth = server.getOAuthApi(bindings);
    if (url.pathname === authorizePath && ["GET", "POST"].includes(request.method))
      return await authorize(request, bindings, oauth);
    if (url.pathname === `${basePath}/login` && request.method === "POST")
      return await login(request, bindings, oauth);
    if (
      (url.pathname === "/api/mcp/connections" && request.method === "GET") ||
      (url.pathname === "/api/mcp/connections/revoke" && request.method === "POST")
    )
      return await manageConnections(request, bindings, oauth);
    if (url.pathname === `${basePath}/error`)
      return mcpErrorPage(
        "ログインを完了できませんでした。連携先から接続を開始し直してください。",
        400,
      );
    // The provider owns discovery, DCR, token exchange and revocation, including
    // their cross-origin protocol validation. Browser-form CSRF checks do not apply.
    return await server.fetch(request, bindings, ctx);
  } catch (error) {
    if (error instanceof AppError) return mcpErrorPage(error.message, error.status);
    if (error instanceof AuthorizationError) {
      if (request.method === "GET" && error.redirectTo) return redirect(error.redirectTo);
      return mcpErrorPage(
        "認可要求が無効、期限切れ、または使用済みです。連携先から接続を開始し直してください。",
        400,
      );
    }
    if (error instanceof CimdFetchError)
      return mcpErrorPage("連携先の公開情報を確認できませんでした。", 400);
    return mcpErrorPage(
      "連携処理を利用できません。しばらくしてから接続を開始し直してください。",
      503,
    );
  }
}
