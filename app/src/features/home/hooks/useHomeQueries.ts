import {
  queryOptions,
  useMutation,
  useMutationState,
  useQueryClient,
  useSuspenseQueries,
} from "@tanstack/react-query";

import {
  getTaskOverview,
  listShoppingItems,
  postTaskCompletionToggle,
  type TaskCompletionActor,
  type TaskOverviewResponse,
} from "../../../lib/api/operations";
import {
  monthlyPenaltySummaryQueryOptions,
  penaltyRulesWithDeletedQueryOptions,
} from "../../../shared/query/monthlyPenaltyQueries";
import { queryKeys } from "../../../shared/query/queryKeys";
import { handleTeamStatePreconditionFailure } from "../../../shared/query/teamStateRefresh";
import { dateStringInJST, formatError, todayString } from "../../../shared/utils/errors";
import { previousMonthKey } from "../utils/month";
import { usePendingShoppingRemovals } from "../../shopping-list";

type CompletionAction = "toggle" | "increment" | "decrement";
const completionMutationKey = ["task-completion"];
type CompletionChange = {
  taskId: string;
  action?: CompletionAction;
  targetDate: string;
  actor?: TaskCompletionActor;
  completed: boolean;
  count: number;
};

function showCompletion(
  home: TaskOverviewResponse,
  change: CompletionChange,
): TaskOverviewResponse {
  if (home.today !== change.targetDate) return home;
  return {
    ...home,
    dailyTasks: home.dailyTasks.map((item) =>
      item.task.id === change.taskId
        ? {
            ...item,
            completedToday: change.completed,
            completedBy: change.completed ? (item.completedBy ?? change.actor) : null,
          }
        : item,
    ),
    weeklyTasks: home.weeklyTasks.map((item) =>
      item.task.id === change.taskId
        ? {
            ...item,
            weekCompletedCount: change.count,
            completionSlots: item.completionSlots.map((slot) => ({
              ...slot,
              actor: slot.slot <= change.count ? (slot.actor ?? change.actor) : null,
            })),
          }
        : item,
    ),
  };
}

function usePendingCompletions() {
  return useMutationState({
    filters: { mutationKey: completionMutationKey, status: "pending" },
    select: (mutation) => mutation.state.variables as CompletionChange,
  });
}

export const homeQueryOptions = queryOptions({
  queryKey: queryKeys.home,
  queryFn: async ({ signal }) => (await getTaskOverview({ signal })).data,
});

export const homeShoppingItemsQueryOptions = queryOptions({
  queryKey: queryKeys.shoppingItems,
  queryFn: async ({ signal }) => (await listShoppingItems({ signal })).data.items ?? [],
});

export const previousMonthPenaltySummaryQueryOptions = () =>
  monthlyPenaltySummaryQueryOptions(previousMonthKey(dateStringInJST().slice(0, 7)));

export function useHomePageQueries() {
  const pendingCompletions = usePendingCompletions();
  const pendingShoppingIds = usePendingShoppingRemovals();
  const previousMonth = previousMonthKey(dateStringInJST().slice(0, 7));
  const [homeQuery, shoppingItemsQuery, previousMonthPenaltySummaryQuery, penaltyRulesQuery] =
    useSuspenseQueries({
      queries: [
        homeQueryOptions,
        homeShoppingItemsQueryOptions,
        monthlyPenaltySummaryQueryOptions(previousMonth),
        penaltyRulesWithDeletedQueryOptions,
      ],
    });

  return {
    homeQuery: { ...homeQuery, data: pendingCompletions.reduce(showCompletion, homeQuery.data) },
    shoppingItemsQuery: {
      ...shoppingItemsQuery,
      data: shoppingItemsQuery.data.filter((item) => !pendingShoppingIds.includes(item.id)),
    },
    previousMonth,
    previousMonthPenaltySummaryQuery,
    penaltyRulesQuery,
  };
}

export function useToggleCompletionMutation(
  setStatus: (message: string) => void,
  actor?: TaskCompletionActor,
) {
  const queryClient = useQueryClient();
  const pending = usePendingCompletions();

  const mutation = useMutation({
    mutationKey: completionMutationKey,
    onMutate: () => queryClient.cancelQueries({ queryKey: queryKeys.home }),
    mutationFn: ({ taskId, action, targetDate }: CompletionChange) =>
      postTaskCompletionToggle(taskId, { targetDate, action }),
    onSuccess: async ({ data }, change) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.home });
      queryClient.setQueryData<TaskOverviewResponse>(
        queryKeys.home,
        (home) =>
          home &&
          showCompletion(home, {
            ...change,
            completed: data.completed,
            count: data.weeklyCompletedCount,
          }),
      );
    },
    onError: async (error) => {
      if (await handleTeamStatePreconditionFailure(error, queryClient, setStatus)) {
        return;
      }
      setStatus(`更新失敗: ${formatError(error)}`);
    },
    onSettled: () => {
      // 一連のタップが落ち着いてから同期し、各タップごとの全体再取得を避ける。
      if (queryClient.isMutating({ mutationKey: completionMutationKey }) === 1) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.home });
        void queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary });
      }
    },
  });

  return {
    pendingTaskIds: pending.map((change) => change.taskId),
    toggle: ({ taskId, action }: { taskId: string; action?: CompletionAction }) => {
      // 同じ対象への連打は抑止する。他のタスクはすぐ操作できる。
      if (
        queryClient.isMutating({
          mutationKey: completionMutationKey,
          predicate: (item) => (item.state.variables as CompletionChange).taskId === taskId,
        })
      )
        return;
      const home = queryClient.getQueryData<TaskOverviewResponse>(queryKeys.home);
      const daily = home?.dailyTasks.find((item) => item.task.id === taskId);
      const weekly = home?.weeklyTasks.find((item) => item.task.id === taskId);
      const previous = weekly?.weekCompletedCount ?? 0;
      const required = weekly?.requiredCompletionsPerWeek ?? 1;
      const decrease =
        action === "decrement" || (required <= 1 && action !== "increment" && previous > 0);
      const count = Math.max(0, Math.min(required, previous + (decrease ? -1 : 1)));
      mutation.mutate({
        taskId,
        action,
        actor,
        targetDate: todayString(),
        completed: daily ? !daily.completedToday : count >= required,
        count,
      });
    },
  };
}
