import { expect, test, type Page } from "@playwright/test";
import { mcpConsentPage, mcpHtml, mcpLoginPage } from "../../src/server/transport/mcp-pages";

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
  ) => {
    status: number;
    headers?: Record<string, string>;
    body?: string;
  } | null,
) {
  const session = await page.context().newCDPSession(page);
  session.on("Fetch.requestPaused", async ({ requestId, request }) => {
    const response = respond(request.url, request.method, new Headers(request.headers));
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
