// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleRequest } from "./index";

describe("frontend worker", () => {
  const fetchAsset = vi.fn<(request: Request) => Promise<Response>>();
  const fetchUpstream = vi.fn<(request: Request) => Promise<Response>>();

  beforeEach(() => {
    fetchAsset.mockReset();
    fetchUpstream.mockReset();
  });

  it("proxies API requests to the configured HTTPS origin", async () => {
    fetchUpstream.mockResolvedValue(new Response("upstream", { status: 201 }));
    const request = new Request(
      "https://app.example/api/v1/tasks?include=all",
      {
        method: "POST",
        headers: { Cookie: "session=opaque" },
        body: "{}",
      },
    );

    const response = await handleRequest(request, {
      apiOrigin: "https://api.example",
      fetchAsset,
      fetchUpstream,
    });

    expect(response.status).toBe(201);
    expect(fetchAsset).not.toHaveBeenCalled();
    expect(fetchUpstream).toHaveBeenCalledOnce();
    const upstreamRequest = fetchUpstream.mock.calls[0][0];
    expect(upstreamRequest.url).toBe(
      "https://api.example/v1/tasks?include=all",
    );
    expect(upstreamRequest.method).toBe("POST");
    expect(upstreamRequest.headers.get("Cookie")).toBe("session=opaque");
    await expect(upstreamRequest.text()).resolves.toBe("{}");
  });

  it.each([
    undefined,
    "http://api.example",
    "https://user:password@api.example",
    "https://api.example/base-path",
  ])("rejects a missing or unsafe API origin: %s", async (apiOrigin) => {
    const response = await handleRequest(
      new Request("https://app.example/api/v1/tasks"),
      { apiOrigin, fetchAsset, fetchUpstream },
    );

    expect(response.status).toBe(503);
    expect(fetchUpstream).not.toHaveBeenCalled();
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it("allows an HTTP loopback origin for local development", async () => {
    fetchUpstream.mockResolvedValue(new Response(null, { status: 204 }));

    const response = await handleRequest(
      new Request("http://localhost:8787/api/v1/health"),
      {
        apiOrigin: "http://127.0.0.1:8080",
        fetchAsset,
        fetchUpstream,
      },
    );

    expect(response.status).toBe(204);
    expect(fetchUpstream.mock.calls[0][0].url).toBe(
      "http://127.0.0.1:8080/v1/health",
    );
  });

  it("adds browser security headers to asset responses", async () => {
    fetchAsset.mockResolvedValue(
      new Response("asset", { headers: { "Cache-Control": "public" } }),
    );

    const response = await handleRequest(
      new Request("https://app.example/index.html"),
      { fetchAsset, fetchUpstream },
    );

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    expect(response.headers.get("Cache-Control")).toBe("public");
  });

  it("prevents stale service worker caching", async () => {
    fetchAsset.mockResolvedValue(new Response("worker"));

    const response = await handleRequest(
      new Request("https://app.example/sw.js"),
      { fetchAsset, fetchUpstream },
    );

    expect(response.headers.get("Cache-Control")).toBe(
      "no-cache, no-store, must-revalidate",
    );
  });
});
