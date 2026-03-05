import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import {
  getTaskOverview,
  postTaskCompletionToggle,
} from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import {
  formatError,
  isPreconditionFailure,
  todayString,
} from "../../../shared/utils/errors";

type CompletionAction = "toggle" | "increment" | "decrement";

export function useHomeQuery() {
  return useSuspenseQuery({
    queryKey: queryKeys.home,
    queryFn: async () => (await getTaskOverview()).data,
    refetchInterval: 30_000,
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
      if (isPreconditionFailure(error)) {
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
