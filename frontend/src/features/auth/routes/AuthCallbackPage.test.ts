import { beforeEach, describe, expect, it, vi } from "vitest";

import { authCallbackLoader } from "./AuthCallbackPage";

const mockExchange = vi.fn();
const mockWriteFlash = vi.fn();

vi.mock("../../../lib/api/generated/client", () => ({
  postAuthSessionsExchange: (...args: unknown[]) => mockExchange(...args),
}));

vi.mock("../state/flash", () => ({
  writeFlashStatus: (...args: unknown[]) => mockWriteFlash(...args),
}));

describe("authCallbackLoader", () => {
  beforeEach(() => {
    mockExchange.mockReset();
    mockWriteFlash.mockReset();
  });

  it("exchanges session and redirects to root", async () => {
    mockExchange.mockResolvedValue({ data: { user: { id: "u1" } } });

    const response = await authCallbackLoader({
      request: new Request("http://localhost/auth/callback?exchangeCode=abc"),
      params: {},
      context: undefined,
      unstable_pattern: "",
    });

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
