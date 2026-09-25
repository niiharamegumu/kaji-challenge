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
  postTaskCompletion,
  type TaskCompletionActor,
  type TaskCompletionRequest,
  type TaskOverviewResponse,
} from "../../../lib/api/operations";
import {
  monthlyPenaltySummaryQueryOptions,
  penaltyRulesWithDeletedQueryOptions,
} from "../../../shared/query/monthlyPenaltyQueries";
import { queryKeys } from "../../../shared/query/queryKeys";
import { dateStringInJST, formatError, todayString } from "../../../shared/utils/errors";
import { previousMonthKey } from "../utils/month";
import { usePendingShoppingRemovals } from "../../shopping-list";

type CompletionAction = TaskCompletionRequest["action"];
type CompletionIntent = { taskId: string; action?: "toggle" | "increment" | "decrement" };
const completionMutationKey = ["task-completion"];
type CompletionChange = {
  taskId: string;
  action: CompletionAction;
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

/** 確定済みデータへ未完了mutationを重ねる。共有キャッシュの全体rollbackはしない。 */
function applyChange(home: TaskOverviewResponse, change: CompletionChange): TaskOverviewResponse {
  let count = change.count;
  if (change.action === "increment" || change.action === "decrement") {
    const weekly = home.weeklyTasks.find((item) => item.task.id === change.taskId);
    const delta = change.action === "increment" ? 1 : -1;
    const required = weekly?.requiredCompletionsPerWeek ?? 1;
    const current = weekly?.weekCompletedCount ?? 0;
    count = Math.max(0, Math.min(required, current + delta));
  }
  return showCompletion(home, { ...change, count });
}

/** UIのタップをAPIの希望状態に変換する。複数回の週間タスクだけは加減算を送る。 */
function completionChange(
  home: TaskOverviewResponse,
  intent: CompletionIntent,
  actor?: TaskCompletionActor,
): CompletionChange | undefined {
  const common = { taskId: intent.taskId, targetDate: todayString(), actor };
  const daily = home.dailyTasks.find((item) => item.task.id === intent.taskId);
  if (daily) {
    const completed = !daily.completedToday;
    return { ...common, action: completed ? "complete" : "incomplete", completed, count: 0 };
  }

  const weekly = home.weeklyTasks.find((item) => item.task.id === intent.taskId);
  if (!weekly) return;
  const required = weekly.requiredCompletionsPerWeek;
  if (required <= 1) {
    const completed = weekly.weekCompletedCount === 0;
    return {
      ...common,
      action: completed ? "complete" : "incomplete",
      completed,
      count: completed ? 1 : 0,
    };
  }

  const action = intent.action === "decrement" ? "decrement" : "increment";
  const delta = action === "increment" ? 1 : -1;
  const count = Math.max(0, Math.min(required, weekly.weekCompletedCount + delta));
  return { ...common, action, count, completed: count >= required };
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
    homeQuery: { ...homeQuery, data: pendingCompletions.reduce(applyChange, homeQuery.data) },
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
      postTaskCompletion(taskId, { targetDate, action }),
    onSuccess: async ({ data }, change) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.home });
      // 週次は応答の絶対件数ではなく、この操作の増減だけを反映する。
      // 応答順が逆転しても、他のpending mutationを二重に数えない。最後にDBと同期する。
      queryClient.setQueryData<TaskOverviewResponse>(
        queryKeys.home,
        (home) => home && applyChange(home, { ...change, completed: data.completed }),
      );
    },
    onError: async (error) => {
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
    pendingTaskIds: pending
      .filter((change) => change.action === "complete" || change.action === "incomplete")
      .map((change) => change.taskId),
    toggle: (intent: CompletionIntent) => {
      const home = queryClient.getQueryData<TaskOverviewResponse>(queryKeys.home);
      if (!home) return;
      const change = completionChange(home, intent, actor);
      if (!change) return;

      // 日間・週1回は保存中の反転を抑止し、週複数回の加減は連続操作できる。
      const isStateChange = change.action === "complete" || change.action === "incomplete";
      const taskHasPendingChange =
        queryClient.isMutating({
          mutationKey: completionMutationKey,
          predicate: (item) => (item.state.variables as CompletionChange).taskId === intent.taskId,
        }) > 0;
      if (isStateChange && taskHasPendingChange) return;

      mutation.mutate(change);
    },
  };
}
