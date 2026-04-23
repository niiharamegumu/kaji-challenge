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
import { formatError, todayString } from "../../../shared/utils/errors";
import { handleTeamStatePreconditionFailure } from "../../shell/lib/teamStateRefresh";

type CompletionAction = "toggle" | "increment" | "decrement";

export function useHomeQuery() {
  return useSuspenseQuery({
    queryKey: queryKeys.home,
    queryFn: async () => (await getTaskOverview()).data,
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
    onError: async (error) => {
      if (
        await handleTeamStatePreconditionFailure(error, queryClient, setStatus)
      ) {
        return;
      }
      setStatus(`更新失敗: ${formatError(error)}`);
    },
  });
}
