import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MeResponse, User } from "../../../lib/api/generated/client";
import { useAuthGate } from "./useAuthGate";

const makeUser = (overrides?: Partial<User>): User => ({
  id: "u1",
  email: "owner@example.com",
  displayName: "Owner",
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

function buildParams(overrides?: Partial<Parameters<typeof useAuthGate>[0]>) {
  const meData: MeResponse = {
    user: makeUser(),
    memberships: [{ teamId: "t1", role: "owner", teamName: "Team A" }],
  };
  return {
    loggedIn: false,
    meData: undefined as MeResponse | undefined,
    meStatus: "pending" as const,
    meIsError: false,
    meIsSuccess: false,
    meError: null as unknown,
    pathname: "/",
    navigate: vi.fn(),
    queryClient: {
      removeQueries: vi.fn(),
    } as unknown as Parameters<typeof useAuthGate>[0]["queryClient"],
    setSession: vi.fn(),
    setStatus: vi.fn(),
    refetchMe: vi.fn().mockResolvedValue(undefined),
    ...overrides,
    _meDataFixture: meData,
  };
}

describe("useAuthGate", () => {
  it("reports auth checking while me query is pending without data", () => {
    const params = buildParams();

    const { result } = renderHook(() => useAuthGate(params));

    expect(result.current.isAuthChecking).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("handles validated-session 401 by clearing protected queries and redirecting", async () => {
    const params = buildParams({
      loggedIn: true,
      meData: buildParams()._meDataFixture,
      meStatus: "success",
      meIsSuccess: true,
    });

    const { rerender } = renderHook((p) => useAuthGate(p), {
      initialProps: params,
    });

    await waitFor(() => {
      expect(params.setSession).toHaveBeenCalledWith({ authenticated: true });
    });

    const errorParams = {
      ...params,
      meStatus: "error" as const,
      meIsSuccess: false,
      meIsError: true,
      meError: new Error("request failed: 401"),
      pathname: "/admin/tasks",
    };
    rerender(errorParams);

    await waitFor(() => {
      expect(errorParams.queryClient.removeQueries).toHaveBeenCalledTimes(7);
      expect(errorParams.navigate).toHaveBeenCalledWith("/", { replace: true });
      expect(errorParams.setStatus).toHaveBeenCalledWith(
        "アカウント情報が無効になったため、トップページへ戻りました。再ログインしてください。",
      );
    });
  });

  it("does not redirect on 401 before session is validated", async () => {
    const params = buildParams({
      loggedIn: false,
      meStatus: "error",
      meIsError: true,
      meError: new Error("request failed: 401"),
      pathname: "/admin/tasks",
    });

    renderHook(() => useAuthGate(params));

    await waitFor(() => {
      expect(params.navigate).not.toHaveBeenCalled();
      expect(params.queryClient.removeQueries).not.toHaveBeenCalled();
    });
  });
});
