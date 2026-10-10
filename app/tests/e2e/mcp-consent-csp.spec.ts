import { expect, test, type Page } from "@playwright/test";
import {
  mcpConnectionsPage,
  mcpConsentPage,
  mcpHtml,
  mcpLoginPage,
} from "../../src/server/transport/mcp-pages";

test.use({
  serviceWorkers: "block",
  launchOptions: {
    proxy: { server: "http://127.0.0.1:9" },
    args: ["--proxy-bypass-list=<-loopback>"],
  },
});

// Playwright page.route does not re-intercept every redirected request. Use the
// Chromium Fetch domain for every hop; the dead proxy is an additional network
// guard if any request escapes interception.
async function interceptAll(
  page: Page,
  respond: (
    url: string,
    method: string,
    headers: Headers,
    body?: string,
  ) => {
    status: number;
    headers?: Record<string, string>;
    body?: string;
  } | null,
) {
  const session = await page.context().newCDPSession(page);
  session.on("Fetch.requestPaused", async ({ requestId, request }) => {
    const response = respond(
      request.url,
      request.method,
      new Headers(request.headers),
      request.postData,
    );
    if (!response) {
      await session.send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
      return;
    }
    await session.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: response.status,
      responseHeaders: Object.entries(response.headers ?? {}).map(([name, value]) => ({
        name,
        value,
      })),
      body: Buffer.from(response.body ?? "").toString("base64"),
    });
  });
  await session.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
}

const appOrigin = "https://app.example.test";
const authorizeUrl = `${appOrigin}/api/mcp/oauth/authorize?client_id=test-client`;

function consentHtml(redirectUri: string) {
  const redirect = new URL(redirectUri);
  return mcpConsentPage(
    {
      clientId: "test-client",
      clientName: "Test client",
      clientDomain: redirect.hostname,
      redirectUri,
      redirectHost: redirect.host,
      redirectIsLoopback: redirect.hostname === "localhost",
      scope: ["todos:read", "todos:write"],
    },
    "test-consent-handle",
    "Test user",
    "Test team",
  );
}

for (const destination of [
  {
    label: "Google sign-in",
    uri: "https://accounts.google.com/o/oauth2/v2/auth?state=test",
    login: true,
  },
  {
    label: "HTTPS MCP client",
    uri: "https://chatgpt.com/test-mcp-callback?code=fixture",
    login: false,
  },
  {
    label: "loopback MCP client",
    uri: "http://localhost:1455/test-mcp-callback?code=fixture",
    login: false,
  },
  {
    label: "IPv4 loopback MCP client",
    uri: "http://127.0.0.1:1455/test-mcp-callback?code=fixture",
    login: false,
  },
]) {
  test(`MCP browser form follows only its validated ${destination.label} redirect`, async ({
    page,
  }) => {
    const document = mcpHtml(
      destination.login ? mcpLoginPage(authorizeUrl) : consentHtml(destination.uri),
      200,
      undefined,
      destination.uri,
    );
    const html = await document.text();
    const submitted: { url: string; origin: string | null; referer: string | null }[] = [];
    const callbackReferers: (string | null)[] = [];
    // All URLs are fulfilled or aborted in this isolated browser. No external
    // OAuth server, logged-in profile, grant or local callback listener is used.
    await interceptAll(page, (url, method, headers) => {
      if (url === authorizeUrl && method === "GET")
        return {
          status: 200,
          headers: Object.fromEntries(document.headers),
          body: html,
        };
      if (method === "POST" && url.startsWith(`${appOrigin}/api/mcp/oauth/`)) {
        submitted.push({ url, origin: headers.get("origin"), referer: headers.get("referer") });
        return {
          status: 303,
          headers: { Location: destination.uri, "Referrer-Policy": "no-referrer" },
        };
      }
      if (url === destination.uri) {
        callbackReferers.push(headers.get("referer"));
        return { status: 200, headers: { "Content-Type": "text/html" }, body: "Callback reached" };
      }
      return null;
    });
    await page.goto(authorizeUrl);
    await page
      .getByRole("button", { name: destination.login ? "Google でログイン" : "選んだ操作を許可" })
      .click();
    await expect(page).toHaveURL(destination.uri);
    await expect(page.locator("body")).toHaveText("Callback reached");
    expect(submitted).toEqual([
      {
        url: `${appOrigin}/api/mcp/oauth/${destination.login ? "login" : "authorize"}`,
        origin: appOrigin,
        referer: authorizeUrl,
      },
    ]);
    expect(callbackReferers).toEqual([null]);
  });
}

test("MCP consent CSP blocks a redirect to an origin that was not approved", async ({ page }) => {
  const allowed = "https://client.example.test/callback";
  const unexpected = "https://untrusted.example.test/callback";
  const document = mcpHtml(consentHtml(allowed), 200, undefined, allowed);
  const html = await document.text();
  let reachedUntrusted = false;
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  await interceptAll(page, (url) => {
    if (url === authorizeUrl)
      return {
        status: 200,
        headers: Object.fromEntries(document.headers),
        body: html,
      };
    if (url === `${appOrigin}/api/mcp/oauth/authorize`)
      return { status: 303, headers: { Location: unexpected, "Referrer-Policy": "no-referrer" } };
    if (url === unexpected) reachedUntrusted = true;
    return null;
  });
  await page.goto(authorizeUrl);
  await page.getByRole("button", { name: "選んだ操作を許可" }).click();
  await expect.poll(() => violations.length).toBeGreaterThan(0);
  expect(page.url()).toBe(authorizeUrl);
  expect(reachedUntrusted).toBe(false);
});

test("MCP consent keeps scopes accessible and submits only the user's native selection", async ({
  page,
}, testInfo) => {
  const redirectUri = "https://chatgpt.com/test-mcp-callback";
  const html = mcpConsentPage(
    {
      clientId: "fixture",
      clientName: "ChatGPT",
      clientDomain: "chatgpt.com",
      redirectUri,
      redirectHost: "chatgpt.com",
      redirectIsLoopback: false,
      scope: ["todos:read", "todos:write"],
    },
    "fixture-consent-handle",
    "山田 花子",
    "わが家のチーム",
  );
  const response = mcpHtml(html, 200, undefined, redirectUri);
  let submitted: URLSearchParams | undefined;
  let unexpectedRequests = 0;
  await interceptAll(page, (url, method, _headers, body) => {
    if (url === authorizeUrl && method === "GET")
      return { status: 200, headers: Object.fromEntries(response.headers), body: html };
    if (url === `${appOrigin}/api/mcp/oauth/authorize` && method === "POST") {
      submitted = new URLSearchParams(body);
      return { status: 200, headers: { "Content-Type": "text/plain" }, body: "Selection received" };
    }
    unexpectedRequests += 1;
    return null;
  });
  await page.goto(authorizeUrl);
  await expect(page.getByRole("heading", { name: "ToDo の連携を許可" })).toBeVisible();
  await expect(page.getByRole("group", { name: "許可する操作" })).toBeVisible();
  await expect(page.getByText("山田 花子", { exact: true })).toBeVisible();
  await expect(page.getByText("この操作は元に戻せません。", { exact: false })).toBeVisible();
  await expect(
    page.getByText("今回の同意から最大7日間で、自動更新されません", { exact: false }),
  ).toBeVisible();
  expect(await page.locator("script,img,iframe,link").count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const approve = page.getByRole("button", { name: "選んだ操作を許可" });
  expect((await approve.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath("mcp-consent.png"), fullPage: true });

  const read = page.getByRole("checkbox", { name: /ToDo とカテゴリーの読み取り/ });
  const write = page.getByRole("checkbox", { name: /ToDo の追加と完了/ });
  await page.keyboard.press("Tab");
  await expect(read).toBeFocused();
  expect(await read.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  await page.keyboard.press("Space");
  await expect(read).not.toBeChecked();
  await page.keyboard.press("Tab");
  await expect(write).toBeFocused();
  await expect(write).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "連携の管理" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(approve).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Selection received")).toBeVisible();
  expect(submitted?.getAll("scope")).toEqual(["todos:write"]);
  expect(submitted?.get("handle")).toBe("fixture-consent-handle");
  expect(submitted?.get("decision")).toBe("approve");
  expect(unexpectedRequests).toBe(0);
});

test("MCP consent reflows long names and seven-day access details without overflow", async ({
  page,
}, testInfo) => {
  const redirectUri = "http://localhost:3456/callback";
  const clientName = `家事の連携アプリ${"LongClientName".repeat(10)}<img src=https://untrusted.example/pixel>`;
  const html = mcpConsentPage(
    {
      clientId: "fixture",
      clientName,
      redirectUri,
      redirectHost: "localhost:3456",
      redirectIsLoopback: true,
      scope: ["todos:read", "todos:write"],
    },
    "fixture-consent-handle",
    "長い名前の利用者".repeat(8),
    "家事を分担するチーム".repeat(8),
  );
  const response = mcpHtml(html, 200, undefined, redirectUri);
  let unexpectedRequests = 0;
  await interceptAll(page, (url) => {
    if (url === authorizeUrl)
      return { status: 200, headers: Object.fromEntries(response.headers), body: html };
    unexpectedRequests += 1;
    return null;
  });
  await page.goto(authorizeUrl);
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await expect(
    page.getByText("この端末で動くアプリへアクセスを渡します。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("連携先の名前は自己申告", { exact: false })).toBeVisible();
  await expect(
    page.getByText("今回の同意から最大7日間で、自動更新されません", { exact: false }),
  ).toBeVisible();
  expect(await page.locator("img,script,iframe").count()).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("mcp-consent-narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 640, height: 720 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "拒否", exact: true })).toBeVisible();
  expect(unexpectedRequests).toBe(0);
});

test("MCP connections distinguish saved consent deadlines from live token validity", async ({
  page,
}, testInfo) => {
  const url = `${appOrigin}/api/mcp/connections`;
  const html = mcpConnectionsPage(
    [
      {
        connection: {
          id: "new",
          userId: "fixture",
          clientId: "client",
          clientName: "新しい連携",
          resource: "https://mcp.example.test/mcp",
          scopes: ["todos:read", "todos:write"],
          grantId: "fixture-grant",
          createdAt: "2026-10-10T00:00:00.000Z",
          expiresAt: "2026-10-17T00:00:00.000Z",
          revokedAt: null,
        },
        handle: "new-handle",
      },
      {
        connection: {
          id: "old",
          userId: "fixture",
          clientId: "old-client",
          clientName: "以前の連携",
          resource: "https://mcp.example.test/mcp",
          scopes: ["todos:read", "offline_access"],
          grantId: null,
          createdAt: "2026-10-01T00:00:00.000Z",
          expiresAt: "2026-10-31T00:00:00.000Z",
          revokedAt: null,
        },
        handle: "old-handle",
      },
    ],
    "2026-10-10T12:00:00.000Z",
  );
  const response = mcpHtml(html);
  let unexpectedRequests = 0;
  await interceptAll(page, (requestUrl) => {
    if (requestUrl === url)
      return { status: 200, headers: Object.fromEntries(response.headers), body: html };
    unexpectedRequests += 1;
    return null;
  });
  await page.goto(url);
  await expect(
    page.getByText("以前の15分トークンは延長されません", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("これはトークンの有効期限や接続状態を示すものではありません。", { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByText("旧方式の継続アクセス（現在は自動更新できません）", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("許可済み（交換未確認）", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "連携を解除", exact: true })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mcp-connections.png"), fullPage: true });
  expect(unexpectedRequests).toBe(0);
});
