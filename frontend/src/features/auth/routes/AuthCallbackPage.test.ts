import type { LoaderFunctionArgs } from "react-router-dom";
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

function loaderArgs(url: string): LoaderFunctionArgs {
  return {
    request: new Request(url),
    url: new URL(url),
    pattern: "/auth/callback",
    params: {},
    context: undefined,
    unstable_pattern: "/auth/callback",
  } as unknown as LoaderFunctionArgs;
}

describe("authCallbackLoader", () => {
  beforeEach(() => {
    mockExchange.mockReset();
    mockWriteFlash.mockReset();
  });

  it("exchanges session and redirects to root", async () => {
    mockExchange.mockResolvedValue({ data: { user: { id: "u1" } } });

    const response = await authCallbackLoader(
      loaderArgs("http://localhost/auth/callback?exchangeCode=abc"),
    );

    expect(mockWriteFlash).toHaveBeenCalledWith(
      "ログインしました",
      "login_success",
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
  });

  it("writes error flash on exchange failure", async () => {
    mockExchange.mockRejectedValue(new Error("request failed: 401"));

    const response = await authCallbackLoader(
      loaderArgs("http://localhost/auth/callback?exchangeCode=abc"),
    );

    expect(mockWriteFlash).toHaveBeenCalledWith(
      "ログインに失敗しました: 通信エラー（HTTP 401）",
    );
    expect(response.status).toBe(302);
  });

  it("writes forbidden flash when callback carries signup_forbidden", async () => {
    const response = await authCallbackLoader(
      loaderArgs("http://localhost/auth/callback?errorCode=signup_forbidden"),
    );

    expect(mockExchange).not.toHaveBeenCalled();
    expect(mockWriteFlash).toHaveBeenCalledWith(
      "このアカウントは現在の招待制リリース対象外です。",
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
  });

  it("writes oidc mismatch flash when callback carries oidc_identity_mismatch", async () => {
    const response = await authCallbackLoader(
      loaderArgs(
        "http://localhost/auth/callback?errorCode=oidc_identity_mismatch",
      ),
    );

    expect(mockExchange).not.toHaveBeenCalled();
    expect(mockWriteFlash).toHaveBeenCalledWith(
      "アカウント連携情報が一致しません。サポートに連絡してください。",
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
  });
});
