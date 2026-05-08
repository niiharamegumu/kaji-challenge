import type { QueryClient } from "@tanstack/react-query";

import { isPreconditionFailure } from "../utils/errors";
import { queryKeys } from "./queryKeys";

type QueryInvalidator = Pick<QueryClient, "invalidateQueries">;

type StatusSetter = (message: string) => void;

export const preconditionFailureStatusMessage =
  "他メンバーの更新を検知しました。最新状態に更新したので、もう一度操作してください。";

const teamStateRefreshQueryKeys = [
  queryKeys.me,
  queryKeys.teamMembers,
  queryKeys.currentInvite,
  queryKeys.home,
  queryKeys.tasks,
  queryKeys.rules,
  queryKeys.shoppingItems,
  queryKeys.reminders,
  queryKeys.reminderDefinitions,
  queryKeys.monthlySummary,
] as const;

export async function refreshTeamState(queryClient: QueryInvalidator) {
  await Promise.all(
    teamStateRefreshQueryKeys.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}

export async function handleTeamStatePreconditionFailure(
  error: unknown,
  queryClient: QueryInvalidator,
  setStatus: StatusSetter,
) {
  if (!isPreconditionFailure(error)) {
    return false;
  }

  await refreshTeamState(queryClient);
  setStatus(preconditionFailureStatusMessage);
  return true;
}
