import { beforeEach, describe, expect, it, vi } from "vitest";

import { authCallbackLoader } from "./AuthCallbackPage";

const mockWriteToken = vi.fn();
const mockExchange = vi.fn();
const mockWriteFlash = vi.fn();

vi.mock("../../../lib/api/client", () => ({
  writeAccessToken: (...args: unknown[]) => mockWriteToken(...args),
}));

vi.mock("../../../lib/api/generated/client", () => ({
  postAuthSessionsExchange: (...args: unknown[]) => mockExchange(...args),
}));

vi.mock("../state/flash", () => ({
  writeFlashStatus: (...args: unknown[]) => mockWriteFlash(...args),
}));

describe("authCallbackLoader", () => {
  beforeEach(() => {
    mockWriteToken.mockReset();
    mockExchange.mockReset();
    mockWriteFlash.mockReset();
  });

  it("stores token and redirects to root", async () => {
    mockExchange.mockResolvedValue({ data: { accessToken: "token-1" } });

    const response = await authCallbackLoader({
      request: new Request("http://localhost/auth/callback?exchangeCode=abc"),
      params: {},
      context: undefined,
      unstable_pattern: "",
    });

    expect(mockWriteToken).toHaveBeenCalledWith("token-1");
    expect(mockWriteFlash).toHaveBeenCalledWith("ログインしました");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
  });

  it("writes error flash on exchange failure", async () => {
    mockExchange.mockRejectedValue(new Error("request failed: 401"));

    const response = await authCallbackLoader({
      request: new Request("http://localhost/auth/callback?exchangeCode=abc"),
      params: {},
      context: undefined,
      unstable_pattern: "",
    });

    expect(mockWriteFlash).toHaveBeenCalledWith(
      "ログインに失敗しました: 通信エラー（HTTP 401）",
    );
    expect(response.status).toBe(302);
  });
});
