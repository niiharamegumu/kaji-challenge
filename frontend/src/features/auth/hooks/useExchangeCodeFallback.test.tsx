import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useExchangeCodeFallback } from "./useExchangeCodeFallback";

const mockExchange = vi.fn();

vi.mock("../../../lib/api/generated/client", () => ({
  postAuthSessionsExchange: (...args: unknown[]) => mockExchange(...args),
}));

describe("useExchangeCodeFallback", () => {
  beforeEach(() => {
    mockExchange.mockReset();
    window.history.pushState({}, "", "/");
  });

  it("calls the login success callback after exchange succeeds", async () => {
    mockExchange.mockResolvedValue({ data: { user: { id: "u1" } } });
    const setSession = vi.fn();
    const setStatus = vi.fn();
    const onLoginSuccess = vi.fn();

    window.history.pushState({}, "", "/?exchangeCode=abc");

    renderHook(() =>
      useExchangeCodeFallback(setSession, setStatus, onLoginSuccess),
    );

    await waitFor(() => {
      expect(mockExchange).toHaveBeenCalledWith({ exchangeCode: "abc" });
      expect(setSession).toHaveBeenCalledWith({ authenticated: true });
      expect(setStatus).toHaveBeenCalledWith("ログインしました");
      expect(onLoginSuccess).toHaveBeenCalledTimes(1);
    });
  });
});
