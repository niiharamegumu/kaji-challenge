import { beforeEach, describe, expect, it, vi } from "vitest";

import { customFetch, setApiBaseUrl, setLatestTeamEtag } from "./client";

describe("customFetch", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    setApiBaseUrl("/api");
    setLatestTeamEtag("");
  });

  it("preserves Headers input and does not overwrite its content type", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ETag: '"team-2"' },
      }),
    );

    await customFetch("/v1/auth/sessions/exchange", {
      method: "POST",
      body: "payload",
      headers: new Headers({
        "Content-Type": "text/plain",
        "X-Request-Id": "request-1",
      }),
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("Content-Type")).toBe("text/plain");
    expect(headers.get("X-Request-Id")).toBe("request-1");
    expect(init?.credentials).toBe("include");
  });

  it("recognizes a case-insensitive If-Match tuple header", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await customFetch("/v1/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ title: "updated" }),
      headers: [["if-match", '"caller-etag"']],
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("If-Match")).toBe('"caller-etag"');
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});
