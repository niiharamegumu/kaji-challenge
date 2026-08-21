import { describe, expect, it, vi } from "vitest";

import { queryKeys } from "./queryKeys";
import {
  handleTeamStatePreconditionFailure,
  preconditionFailureStatusMessage,
  refreshTeamState,
} from "./teamStateRefresh";

describe("teamStateRefresh", () => {
  it("refreshTeamState invalidates all protected queries", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await refreshTeamState({ invalidateQueries });

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
      queryKey: queryKeys.reminders,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.reminderDefinitions,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.monthlySummary,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.monthCloseCandidate,
    });
  });

  it("refreshes and sets status when precondition fails", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const setStatus = vi.fn();

    const handled = await handleTeamStatePreconditionFailure(
      { name: "ApiRequestError", message: "stale", status: 412 },
      { invalidateQueries },
      setStatus,
    );

    expect(handled).toBe(true);
    expect(setStatus).toHaveBeenCalledWith(preconditionFailureStatusMessage);
  });
});
