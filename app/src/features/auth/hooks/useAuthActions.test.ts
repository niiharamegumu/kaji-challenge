import { describe, expect, it, vi } from "vitest";

import { useMeQuery } from "./useAuthActions";

const mockUseQuery = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useQueryClient: vi.fn(),
}));

vi.mock("../../../lib/api/operations", () => ({
  getMe: vi.fn(),
}));

describe("useMeQuery", () => {
  it("uses auth-specific refetch options", () => {
    useMeQuery(true);

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["me"],
        enabled: true,
        staleTime: 300000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        retry: false,
      }),
    );
  });
});
