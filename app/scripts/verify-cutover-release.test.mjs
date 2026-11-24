import assert from "node:assert/strict";
import test from "node:test";
import { verifyCutoverRelease } from "./verify-cutover-release.mjs";

const env = {
  APP_ORIGIN: "https://example.com",
  APP_RELEASE: "new",
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLOUDFLARE_API_TOKEN: "fixture",
};

test("checks the public release and stops on service errors or a stale release", async () => {
  for (const [response, expected] of [
    [Response.json({ status: "ok", release: "new" }), true],
    [Response.json({ status: "ok", release: "old" }), false],
    [new Response(null, { status: 503 }), false],
  ]) {
    assert.equal(
      await verifyCutoverRelease(env, (url, options) => {
        assert.equal(String(url), "https://example.com/health");
        assert.equal(options.headers, undefined);
        return response;
      }),
      expected,
    );
  }
});

test("a denied public request requires the correct domain and a full rollout of the expected release", async () => {
  for (const [enabled, percentage, release, expected] of [
    [true, 100, "new", true],
    [false, 100, "new", false],
    [true, 90, "new", false],
    [true, 100, "old", false],
  ]) {
    const request = (url, options) => {
      if (String(url) === "https://example.com/health") return new Response(null, { status: 403 });
      const api = new URL(url);
      assert.equal(api.origin, "https://api.cloudflare.com");
      assert.equal(options.headers.Authorization, "Bearer fixture");
      const responses = {
        "/domains?hostname=example.com": [{ hostname: "example.com", service: "app", enabled }],
        "/scripts/app/deployments": {
          deployments: [{ versions: [{ version_id: "v", percentage }] }],
        },
        "/scripts/app/versions/v": {
          resources: { bindings: [{ name: "APP_RELEASE", type: "plain_text", text: release }] },
        },
      };
      const result =
        responses[api.pathname.replace("/client/v4/accounts/account/workers", "") + api.search];
      assert.ok(result, "unexpected Cloudflare request");
      return Response.json({ success: true, result });
    };
    assert.equal(await verifyCutoverRelease(env, request), expected);
  }
});
