import { useQuery } from "@tanstack/react-query";

import {
  getTeamCurrentInvite,
  getTeamCurrentMembers,
  listPenaltyRules,
  listTasks,
} from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import { extractHttpStatus } from "../../../shared/utils/errors";

export function useTasksQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.tasks,
    queryFn: async () => (await listTasks()).data.items,
    enabled,
  });
}

export function usePenaltyRulesQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.rules,
    queryFn: async () => (await listPenaltyRules()).data.items,
    enabled,
  });
}

export function useCurrentTeamMembersQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.teamMembers,
    queryFn: async () => (await getTeamCurrentMembers()).data.items,
    enabled,
  });
}

export function useCurrentInviteQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.currentInvite,
    queryFn: async () => {
      try {
        return (await getTeamCurrentInvite()).data;
      } catch (error) {
        if (extractHttpStatus(error) === 404) {
          return null;
        }
        throw error;
      }
    },
    enabled,
  });
}
