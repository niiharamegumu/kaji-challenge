import { useQuery } from "@tanstack/react-query";

import { listPenaltyRules, listTasks } from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";

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
