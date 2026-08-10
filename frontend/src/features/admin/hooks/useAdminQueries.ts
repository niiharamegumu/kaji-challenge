import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";

import {
  getTeamCurrentInvite,
  getTeamCurrentMembers,
  listPenaltyRules,
  listTasks,
} from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import { extractHttpStatus } from "../../../shared/utils/errors";

export function useTasksQuery() {
  return useSuspenseQuery({
    queryKey: queryKeys.tasks,
    queryFn: async () => (await listTasks()).data.items,
  });
}

export function usePenaltyRulesQuery() {
  return useSuspenseQuery({
    queryKey: queryKeys.rules,
    queryFn: async () => (await listPenaltyRules()).data.items,
  });
}

function currentTeamMembersQueryOptions(currentUserId: string | null) {
  return {
    queryKey: [...queryKeys.teamMembers, currentUserId ?? "none"],
    queryFn: async () => {
      if (currentUserId == null) {
        return [];
      }
      return (await getTeamCurrentMembers()).data.items;
    },
  } as const;
}

function currentInviteQueryOptions(currentUserId: string | null) {
  return {
    queryKey: [...queryKeys.currentInvite, currentUserId ?? "none"],
    queryFn: async () => {
      if (currentUserId == null) {
        return null;
      }
      try {
        return (await getTeamCurrentInvite()).data;
      } catch (error) {
        if (extractHttpStatus(error) === 404) {
          return null;
        }
        throw error;
      }
    },
  } as const;
}

export function useTeamSettingsQueries(currentUserId: string | null) {
  const [membersQuery, currentInviteQuery] = useSuspenseQueries({
    queries: [
      currentTeamMembersQueryOptions(currentUserId),
      currentInviteQueryOptions(currentUserId),
    ],
  });

  return { membersQuery, currentInviteQuery };
}
