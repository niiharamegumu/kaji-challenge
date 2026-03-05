import { useSuspenseQuery } from "@tanstack/react-query";

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

export function useCurrentTeamMembersQuery(currentUserId: string | null) {
  return useSuspenseQuery({
    queryKey: [...queryKeys.teamMembers, currentUserId ?? "none"],
    queryFn: async () => {
      if (currentUserId == null) {
        return [];
      }
      return (await getTeamCurrentMembers()).data.items;
    },
  });
}

export function useCurrentInviteQuery(currentUserId: string | null) {
  return useSuspenseQuery({
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
  });
}
