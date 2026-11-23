import { expect, it, vi } from "vitest";
import { refreshTeamState, teamStateRefreshQueryKeys } from "./teamStateRefresh";
it("refreshes all team query groups", async () => {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  await refreshTeamState({ invalidateQueries });
  expect(invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual(
    teamStateRefreshQueryKeys,
  );
});

it("refreshes shared pages without invalidating chores, scores or monthly totals", async () => {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  await refreshTeamState({ invalidateQueries }, ["shared-pages"]);
  expect(invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual([["shared-pages"]]);
});

it("deduplicates overlapping query groups and fully refreshes membership changes", async () => {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  await refreshTeamState({ invalidateQueries }, ["tasks", "task-completions", "tasks"]);
  expect(invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual([
    ["tasks"],
    ["home"],
    ["monthly-summary"],
    ["month-close-candidate"],
  ]);
  invalidateQueries.mockClear();
  await refreshTeamState({ invalidateQueries }, ["membership", "tasks"]);
  expect(invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual(
    teamStateRefreshQueryKeys,
  );
});
