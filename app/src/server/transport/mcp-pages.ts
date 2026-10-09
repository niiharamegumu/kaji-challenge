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
  // Match LoginCard and tailwind.css without loading scripts, fonts or images
  // into the OAuth document. Keep its restrictive CSP and native form behavior.
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} | KajiChalle</title>
<style>
  :root{color-scheme:light;font-family:"Noto Sans JP",system-ui,-apple-system,sans-serif;color:#292524;background:#f6f4ef;font-synthesis:none}
  *{box-sizing:border-box}body{margin:0;font-size:0.9375rem;line-height:1.75}
  .shell{width:min(100%,44rem);margin:0 auto;padding:40px 24px 32px}
  .brand{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 4px 24px}
  .brand-name{font-size:1.375rem;font-weight:750;letter-spacing:.03em;color:#1c1917}
  .brand-note{font-size:0.75rem;color:#57534e;letter-spacing:.08em}
  main{background:#fff;border:1px solid #e7e5e4;border-radius:24px;padding:32px;box-shadow:0 12px 36px -28px #44403c40}
  h1,h2,p,dl{margin:0}h1{font-size:1.75rem;line-height:1.5;letter-spacing:.01em;color:#1c1917}
  h2,legend{font-size:0.9375rem;font-weight:700;color:#1c1917}p+p{margin-top:8px}
  .eyebrow{margin-bottom:8px;color:#2f663b;font-size:0.75rem;font-weight:700;letter-spacing:.1em}
  .intro{margin-top:12px;color:#57534e}.section{margin-top:28px}
  .details{display:grid;grid-template-columns:6.5rem minmax(0,1fr);gap:10px 16px;margin-top:14px;padding:18px 20px;border-radius:12px;background:#fafaf9;border:1px solid #e7e5e4}
  dt{font-size:0.8125rem;color:#57534e}dd{margin:0;min-width:0;font-weight:600;color:#292524}
  .note{margin-top:12px;font-size:0.8125rem;color:#57534e;line-height:1.8}
  .warning{margin-top:12px;padding:12px 16px;border-radius:10px;background:#fff8ef;color:#78350f;font-size:0.8125rem}
  fieldset{min-width:0;margin:28px 0 0;padding:0;border:0}legend{padding:0;margin-bottom:12px}
  .scope-list{display:grid;gap:10px}.scope{display:flex;align-items:flex-start;gap:13px;padding:16px;border:1px solid #d6d3d1;border-radius:12px;cursor:pointer}
  .scope:has(input:checked){border-color:#95c895;background:#eff8ef}.scope:hover{border-color:#4f9859}
  .scope input{flex-shrink:0;width:20px;height:20px;margin:3px 0 0;accent-color:#2f663b;cursor:pointer}
  .scope-text{min-width:0}.scope-title{display:block;font-weight:650;color:#1c1917}.scope-description{display:block;margin-top:3px;font-size:0.8125rem;color:#44403c}
  .scope-code{display:block;margin-top:5px;font-size:0.6875rem;color:#57534e}
  .duration{margin-top:24px;padding:18px 20px;border-radius:12px;background:#f6f4ef}
  .duration p{margin-top:7px;font-size:0.8125rem;color:#44403c}.duration h2{font-size:0.875rem}
  .actions{display:flex;gap:12px;margin-top:26px}.actions button{flex:1}
  button{min-height:48px;padding:11px 18px;border:1px solid #d6d3d1;border-radius:8px;font:inherit;font-size:0.875rem;font-weight:650;color:#292524;background:#fff;cursor:pointer}
  button:hover{background:#f5f5f4}.primary{border-color:#1c1917;background:#1c1917;color:#fff}.primary:hover{background:#292524}
  a{color:#2f663b;text-underline-offset:3px}a:hover{color:#1c1917}
  :focus-visible{outline:3px solid #3e7f4a;outline-offset:4px}
  .footer{margin-top:22px;text-align:center;font-size:0.8125rem}.footer a{display:inline-block;padding:8px}
  .connection{padding-top:24px;margin-top:24px;border-top:1px solid #e7e5e4}.connection h2{font-size:1.125rem}
  .status{display:inline-block;margin-top:8px;padding:2px 10px;border-radius:6px;background:#f5f5f4;font-size:0.75rem;color:#44403c}
  .connection .duration{margin-top:14px}.connection form{margin-top:14px}.empty{margin-top:24px;padding:24px;text-align:center;border-radius:12px;background:#fafaf9;color:#57534e}
  strong,dd,h1,h2,p,code{overflow-wrap:anywhere}
  @media(max-width:480px){.shell{padding:24px 16px}.brand{margin-bottom:18px}.brand-name{font-size:1.25rem}.brand-note{font-size:0.6875rem}main{padding:24px 20px;border-radius:18px}h1{font-size:1.5rem}.details{grid-template-columns:5.5rem minmax(0,1fr);gap:8px 10px;padding:16px}.actions{flex-direction:column}.scope{padding:14px}.duration{padding:16px}}
  @media(forced-colors:active){.scope:has(input:checked){border-color:Highlight}.primary{border-color:ButtonText}}
</style></head><body><div class="shell">
<header class="brand"><span class="brand-name">KajiChalle</span><span class="brand-note">アプリ連携</span></header>
<main id="main"><p class="eyebrow">いつもの家事を、もっと身近に。</p><h1>${escape(title)}</h1>${body}</main>
<footer class="footer"><a href="/">KajiChalle に戻る</a></footer>
</div></body></html>`;
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
  return mcpHtml(page("連携を続けられません", `<p class="intro">${escape(message)}</p>`), status);
}

export function mcpLoginPage(authorizationUrl: string) {
  return page(
    "KajiChalle にログイン",
    `<p class="intro">Google で本人を確認したあと、連携先と許可する操作を確認できます。</p><form method="post" action="/api/mcp/oauth/login"><input type="hidden" name="authorizationUrl" value="${escape(authorizationUrl)}"><div class="actions"><button class="primary" type="submit">Google でログイン</button></div></form>`,
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
  const scopeDescriptions: Record<string, { title: string; description: string }> = {
    "todos:read": {
      title: "ToDo とカテゴリーの読み取り",
      description: "現在のチームの未完了ToDoとカテゴリーを取得します。",
    },
    "todos:write": {
      title: "ToDo の追加と完了",
      description: "完了した ToDo は削除されます。この操作は元に戻せません。",
    },
    offline_access: {
      title: "継続アクセス",
      description: "ログアウト後も、初回同意から最大30日間アクセスを継続します。",
    },
  };
  const scopes = details.scope
    .map(
      (scope, index) =>
        `<label class="scope"><input type="checkbox" name="scope" value="${escape(scope)}" aria-describedby="scope-description-${index}" checked><span class="scope-text"><span class="scope-title">${escape(scopeDescriptions[scope]?.title ?? scope)}</span><span class="scope-description" id="scope-description-${index}">${escape(scopeDescriptions[scope]?.description ?? "この権限の内容を確認してから許可してください。")}</span><code class="scope-code">${escape(scope)}</code></span></label>`,
    )
    .join("");
  const duration = details.scope.includes("offline_access")
    ? "アクセスはトークン発行から最大15分間です。継続アクセスを許可すると、連携先がトークンを更新して初回同意から最大30日間利用できます。継続アクセスはログアウトでは解除されません。"
    : "この連携先は継続アクセスを要求していません。アクセスはトークン発行から最大15分間で、自動更新されません。期限後は連携先から再接続して許可してください。";
  return page(
    "ToDo の連携を許可",
    `<p class="intro"><strong>${escape(details.clientName)}</strong> が、あなたのToDoへのアクセスを求めています。許可する内容を確認してください。</p>
<section class="section" aria-labelledby="connection-heading"><h2 id="connection-heading">連携するアカウント</h2>
<dl class="details"><dt>ログイン中</dt><dd>${escape(userName)}</dd><dt>現在のチーム</dt><dd>${escape(teamName)}</dd><dt>連携先</dt><dd>${escape(details.clientName)}</dd><dt>認可の送信先</dt><dd>${escape(details.redirectHost)}</dd></dl>
<p class="note">${publisher}</p>
${details.redirectIsLoopback ? '<p class="warning"><strong>この端末で動くアプリへアクセスを渡します。</strong> 自分で開始した接続か確認してください。表示された名前だけではアプリを確認できません。</p>' : ""}
<p class="note">アクセス時点の所属チームと権限を毎回確認します。チームを移ると連携先がアクセスするチームも変わります。</p></section>
<form method="post" action="/api/mcp/oauth/authorize"><input type="hidden" name="handle" value="${escape(handle)}">
<fieldset><legend>許可する操作</legend><div class="scope-list">${scopes}</div></fieldset>
<section class="duration" aria-labelledby="duration-heading"><h2 id="duration-heading">利用できる期間</h2><p>${duration}</p><p><a href="/api/mcp/connections">連携の管理</a>からいつでも解除できます。</p></section>
<div class="actions"><button class="primary" name="decision" value="approve">選んだ操作を許可</button><button name="decision" value="deny">拒否</button></div></form>`,
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
          ? "許可期限切れ"
          : connection.grantId
            ? "許可済み"
            : "認可コードの交換待ち";
      const duration = connection.scopes.includes("offline_access")
        ? `<p>継続アクセスの許可期限: ${escape(connection.expiresAt)}（初回同意から最大30日）。アクセスはトークン発行から最大15分間です。未解除かつ許可期限内の場合に限り、連携先が更新できます。</p>`
        : "<p>短期アクセス（自動更新なし）。トークン発行から最大15分間で終了します。期限後は連携先から再接続して許可してください。</p>";
      return `<article class="connection"><h2>${escape(connection.clientName)}</h2><span class="status">${status}</span><div class="duration">${duration}</div><p class="note">${connection.scopes.map((scope) => escape(scopeLabels[scope] ?? scope)).join("、")}</p><form method="post" action="/api/mcp/connections/revoke"><input type="hidden" name="connectionId" value="${escape(connection.id)}"><input type="hidden" name="handle" value="${escape(handle)}"><button type="submit">${connection.revokedAt ? "トークンの失効を再実行" : "連携を解除"}</button></form></article>`;
    })
    .join("");
  return page(
    "MCP 連携の管理",
    `<p class="intro">ここには過去の許可も表示されます。現在の接続状態を示すものではありません。</p><p class="note">解除すると、この連携先からのアクセスを拒否します。継続アクセスはログアウトでは解除されません。</p>${rows || '<p class="empty">連携はありません。</p>'}`,
  );
}
