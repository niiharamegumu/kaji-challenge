import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getPenaltySummaryMonthly,
  getTaskOverview,
  postTaskCompletionToggle,
} from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import { formatError, todayString } from "../../../shared/utils/errors";

type StatusSetter = (message: string) => void;

export function useHomeQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.home,
    queryFn: async () => (await getTaskOverview()).data,
    enabled,
  });
}

export function useMonthlySummaryQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.monthlySummary,
    queryFn: async () => (await getPenaltySummaryMonthly()).data,
    enabled,
  });
}

export function useToggleCompletionMutation(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string) =>
      postTaskCompletionToggle(taskId, { targetDate: todayString() }),
    onSuccess: async () => {
      setStatus("完了状態を更新しました");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary }),
      ]);
    },
    onError: (error) => {
      setStatus(`完了更新に失敗しました: ${formatError(error)}`);
    },
  });
}
