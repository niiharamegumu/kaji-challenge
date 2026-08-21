import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQueries,
} from "@tanstack/react-query";

import {
  getTaskOverview,
  listShoppingItems,
  postTaskCompletionToggle,
} from "../../../lib/api/generated/client";
import {
  monthlyPenaltySummaryQueryOptions,
  penaltyRulesWithDeletedQueryOptions,
} from "../../../shared/query/monthlyPenaltyQueries";
import { queryKeys } from "../../../shared/query/queryKeys";
import { handleTeamStatePreconditionFailure } from "../../../shared/query/teamStateRefresh";
import {
  dateStringInJST,
  formatError,
  todayString,
} from "../../../shared/utils/errors";
import { previousMonthKey } from "../utils/month";

type CompletionAction = "toggle" | "increment" | "decrement";

export const homeQueryOptions = queryOptions({
  queryKey: queryKeys.home,
  queryFn: async () => (await getTaskOverview()).data,
});

export const homeShoppingItemsQueryOptions = queryOptions({
  queryKey: queryKeys.shoppingItems,
  queryFn: async () => (await listShoppingItems()).data.items ?? [],
});

export const previousMonthPenaltySummaryQueryOptions = () =>
  monthlyPenaltySummaryQueryOptions(
    previousMonthKey(dateStringInJST().slice(0, 7)),
  );

export function useHomePageQueries() {
  const previousMonth = previousMonthKey(dateStringInJST().slice(0, 7));
  const [
    homeQuery,
    shoppingItemsQuery,
    previousMonthPenaltySummaryQuery,
    penaltyRulesQuery,
  ] = useSuspenseQueries({
    queries: [
      homeQueryOptions,
      homeShoppingItemsQueryOptions,
      monthlyPenaltySummaryQueryOptions(previousMonth),
      penaltyRulesWithDeletedQueryOptions,
    ],
  });

  return {
    homeQuery,
    shoppingItemsQuery,
    previousMonth,
    previousMonthPenaltySummaryQuery,
    penaltyRulesQuery,
  };
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
