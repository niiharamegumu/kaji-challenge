import { expect, it, vi } from "vitest";
import { refreshTeamState, teamStateRefreshQueryKeys } from "./teamStateRefresh";
it("refreshes all team query groups", async () => {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  await refreshTeamState({ invalidateQueries });
  expect(invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual(
    teamStateRefreshQueryKeys,
  );
});
