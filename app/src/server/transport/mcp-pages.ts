import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import type { McpConnection } from "../application/mcp-ports";

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

const scopeLabels: Record<string, string> = {
  "todos:read": "ToDo とカテゴリーの読み取り",
  "todos:write": "ToDo の追加と完了（完了した ToDo は削除されます）",
  offline_access: "ログアウト後も最大30日間アクセスを継続",
};

function page(title: string, body: string) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} | KajiChalle</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1rem;color:#17251d;background:#f7faf8}main{background:white;padding:2rem;border:1px solid #d7e1dc;border-radius:1rem}h1{font-size:1.5rem}label{display:block;margin:1rem 0}button,a{font:inherit}button{padding:.5rem 1rem;margin:.4rem .6rem .4rem 0;cursor:pointer}article{border-top:1px solid #d7e1dc;margin-top:1.5rem;padding-top:1rem}code{overflow-wrap:anywhere}strong{overflow-wrap:anywhere}</style></head><body><main><h1>${escape(title)}</h1>${body}<p><a href="/">KajiChalle に戻る</a></p></main></body></html>`;
}

function formRedirectSource(redirectUri: string) {
  const url = new URL(redirectUri);
  const loopback = url.hostname === "localhost" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  // URL parsing alone accepts characters such as ';' and '*' in a hostname.
  // Never turn those into CSP directives or wildcard sources. The caller passes
  // a provider-validated redirect URI; this is an additional header boundary.
  // Browsers do not accept IPv6 literals as CSP host sources.
  const safeHost = /^(?:[a-z0-9-]+\.)*[a-z0-9-]+\.?$/.test(url.hostname);
  if (
    !safeHost ||
    url.username ||
    url.password ||
    url.hash ||
    !(url.protocol === "https:" || (url.protocol === "http:" && loopback))
  )
    throw new Error("Invalid OAuth form redirect origin");
  return url.origin;
}

export function mcpHtml(
  html: string,
  status = 200,
  initialHeaders?: HeadersInit,
  formRedirectUri?: string,
) {
  const headers = new Headers(initialHeaders);
  // Chromium applies form-action to the POST's redirect chain as well. Allow
  // only this page's validated OAuth destination, in addition to its own origin.
  const redirectSource = formRedirectUri ? ` ${formRedirectSource(formRedirectUri)}` : "";
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${redirectSource}; frame-ancestors 'none'; base-uri 'none'`,
  );
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(html, { status, headers });
}

export function mcpErrorPage(message: string, status: number) {
  return mcpHtml(page("連携を続けられません", `<p>${escape(message)}</p>`), status);
}

export function mcpLoginPage(authorizationUrl: string) {
  return page(
    "KajiChalle にログイン",
    `<p>Google で本人を確認したあと、連携先と許可する操作を確認できます。</p><form method="post" action="/api/mcp/oauth/login"><input type="hidden" name="authorizationUrl" value="${escape(authorizationUrl)}"><button type="submit">Google でログイン</button></form>`,
  );
}

export function mcpConsentPage(
  details: ConsentDescription,
  handle: string,
  userName: string,
  teamName: string,
) {
  const publisher = details.clientDomain
    ? `公開元ドメイン: <strong>${escape(details.clientDomain)}</strong>`
    : "連携先の名前は自己申告であり、確認済みの名前ではありません。";
  const scopes = details.scope
    .map(
      (scope) =>
        `<label><input type="checkbox" name="scope" value="${escape(scope)}" checked> ${escape(scopeLabels[scope] ?? scope)} <code>(${escape(scope)})</code></label>`,
    )
    .join("");
  return page(
    "ToDo の連携を許可",
    `<p><strong>${escape(details.clientName)}</strong> が、${escape(userName)} さんの権限でアクセスを求めています。</p><p>${publisher}</p><p>認可の送信先: <strong>${escape(details.redirectHost)}</strong></p>${details.redirectIsLoopback ? "<p><strong>この端末で動くアプリへアクセスを渡します。</strong> 自分で開始した接続か確認してください。表示された名前だけではアプリを確認できません。</p>" : ""}<p>現在のチーム: <strong>${escape(teamName)}</strong>。アクセス時点の所属チームと権限を毎回確認します。チームを移ると連携先がアクセスするチームも変わります。</p><form method="post" action="/api/mcp/oauth/authorize"><input type="hidden" name="handle" value="${escape(handle)}">${scopes}<p>継続アクセスを許可しない場合は最大15分間です。継続アクセスはログアウトでは解除されません。<a href="/api/mcp/connections">連携の管理</a>からいつでも解除できます。</p><button name="decision" value="approve">選んだ操作を許可</button><button name="decision" value="deny">拒否</button></form>`,
  );
}

export function mcpConnectionsPage(
  connections: { connection: McpConnection; handle: string }[],
  now: string,
) {
  const rows = connections
    .map(({ connection, handle }) => {
      const status = connection.revokedAt
        ? "解除済み"
        : connection.expiresAt <= now
          ? "期限切れ"
          : connection.grantId
            ? "連携中"
            : "認可コードの交換待ち";
      return `<article><h2>${escape(connection.clientName)}</h2><p>${status} ／ 有効期限: ${escape(connection.expiresAt)}</p><p>${connection.scopes.map((scope) => escape(scopeLabels[scope] ?? scope)).join("、")}</p><form method="post" action="/api/mcp/connections/revoke"><input type="hidden" name="connectionId" value="${escape(connection.id)}"><input type="hidden" name="handle" value="${escape(handle)}"><button type="submit">${connection.revokedAt ? "トークンの失効を再実行" : "連携を解除"}</button></form></article>`;
    })
    .join("");
  return page(
    "MCP 連携の管理",
    `<p>解除すると、この連携先からのアクセスを拒否します。継続アクセスはログアウト後も期限まで有効です。</p>${rows || "<p>連携はありません。</p>"}`,
  );
}
