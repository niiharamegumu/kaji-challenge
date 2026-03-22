import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { queryKeys } from "../../../shared/query/queryKeys";
import { useTeamStateStream } from "./useTeamStateStream";

describe("useTeamStateStream", () => {
  it("refreshTeamState invalidates all protected queries", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = {
      invalidateQueries,
    } as unknown as Parameters<typeof useTeamStateStream>[0];

    const { result } = renderHook(() => useTeamStateStream(queryClient, false));

    await act(async () => {
      await result.current.refreshTeamState();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.me });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.teamMembers,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.currentInvite,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.home,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.tasks,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.rules,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.shoppingItems,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.monthlySummary,
    });
  });
});
