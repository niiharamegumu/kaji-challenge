import { expect, it, vi } from "vitest";
import { refreshTeamState, teamStateRefreshQueryKeys } from "./teamStateRefresh";
it("refreshes all team query groups", async () => {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  await refreshTeamState({ invalidateQueries });
  expect(invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual(
    teamStateRefreshQueryKeys,
  );
});

it("refreshes only ToDos for a ToDo mutation, leaving unrelated caches fresh", async () => {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  await refreshTeamState({ invalidateQueries }, ["todos"]);
  expect(invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual([["todo-items"]]);
});

it("deduplicates overlapping query groups and fully refreshes membership changes", async () => {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  await refreshTeamState({ invalidateQueries }, ["todos", "todo-categories", "todos"]);
  expect(invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual([
    ["todo-items"],
    ["todo-categories"],
  ]);
  invalidateQueries.mockClear();
  await refreshTeamState({ invalidateQueries }, ["membership", "todos"]);
  expect(invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual(
    teamStateRefreshQueryKeys,
  );
});
