import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "./queryKeys";

type QueryInvalidator = Pick<QueryClient, "invalidateQueries">;

export const teamStateRefreshQueryKeys = [
  queryKeys.me,
  queryKeys.pushSubscriptions,
  queryKeys.teamMembers,
  queryKeys.currentInvite,
  queryKeys.home,
  queryKeys.tasks,
  queryKeys.rules,
  queryKeys.shoppingItems,
  queryKeys.reminders,
  queryKeys.reminderDefinitions,
  queryKeys.monthlySummary,
  queryKeys.monthCloseCandidate,
] as const;

export async function refreshTeamState(queryClient: QueryInvalidator) {
  await Promise.all(
    teamStateRefreshQueryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}
