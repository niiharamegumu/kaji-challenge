import type { QueryClient } from "@tanstack/react-query";
import type { TeamChangeScope } from "../../contracts/realtime";

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
  queryKeys.todoItems,
  queryKeys.todoCategories,
  queryKeys.reminders,
  queryKeys.reminderDefinitions,
  queryKeys.monthlySummary,
  queryKeys.monthCloseCandidate,
] as const;

const changedQueryKeys = {
  profile: [queryKeys.me, queryKeys.teamMembers, queryKeys.home, queryKeys.monthlySummary],
  membership: teamStateRefreshQueryKeys,
  invite: [queryKeys.currentInvite],
  tasks: [queryKeys.tasks, queryKeys.home, queryKeys.monthlySummary, queryKeys.monthCloseCandidate],
  "task-completions": [queryKeys.home, queryKeys.monthlySummary],
  todos: [queryKeys.todoItems],
  "todo-categories": [queryKeys.todoCategories, queryKeys.todoItems],
  reminders: [queryKeys.reminders, queryKeys.reminderDefinitions, queryKeys.home],
  "penalty-rules": [queryKeys.rules, queryKeys.monthlySummary],
  "month-close": [queryKeys.home, queryKeys.monthlySummary, queryKeys.monthCloseCandidate],
  "push-subscriptions": [queryKeys.pushSubscriptions],
} satisfies Record<TeamChangeScope, readonly (readonly string[])[]>;

export async function refreshTeamState(queryClient: QueryInvalidator, changes?: TeamChangeScope[]) {
  const keys =
    changes === undefined
      ? teamStateRefreshQueryKeys
      : [...new Set(changes.flatMap((change) => changedQueryKeys[change]))];
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
