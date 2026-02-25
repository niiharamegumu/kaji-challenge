import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getTaskOverview,
  postTaskCompletionToggle,
} from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import {
  formatError,
  isPreconditionFailed,
  todayString,
} from "../../../shared/utils/errors";

type CompletionAction = "toggle" | "increment" | "decrement";

export function useHomeQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.home,
    queryFn: async () => (await getTaskOverview()).data,
    enabled,
    refetchInterval: enabled ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
}

export function useToggleCompletionMutation(
  setStatus: (message: string) => void,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
      action,
    }: {
      taskId: string;
      action?: CompletionAction;
    }) =>
      postTaskCompletionToggle(taskId, { targetDate: todayString(), action }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary }),
      ]);
    },
    onError: (error) => {
      if (isPreconditionFailed(error)) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.home }),
          queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary }),
        ]);
        setStatus(
          "他メンバーの更新を検知しました。最新状態に更新したので、もう一度操作してください。",
        );
        return;
      }
      setStatus(`更新失敗: ${formatError(error)}`);
    },
  });
}
