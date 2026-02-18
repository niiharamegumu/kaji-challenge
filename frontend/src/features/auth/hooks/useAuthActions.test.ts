import { describe, expect, it, vi } from "vitest";

import { useMeQuery } from "./useAuthActions";

const mockUseQuery = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useQueryClient: vi.fn(),
}));

vi.mock("../../../lib/api/generated/client", () => ({
  getMe: vi.fn(),
  getAuthGoogleStart: vi.fn(),
  postAuthLogout: vi.fn(),
}));

describe("useMeQuery", () => {
  it("uses auth-specific refetch options", () => {
    useMeQuery(true);

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["me"],
        enabled: true,
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: true,
        retry: false,
      }),
    );
  });
});
