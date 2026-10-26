import { todoItemsQueryOptions } from "../../../shared/query/todoQueries";
import {
  queryOptions,
  useMutation,
  useMutationState,
  useQueryClient,
  useSuspenseQueries,
} from "@tanstack/react-query";

import {
  getTaskOverview,
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
import { dateStringInJST } from "../../../shared/utils/dates";
import { formatError } from "../../../shared/utils/errors";
import { previousMonthKey } from "../utils/month";
import { useOptimisticTodoItems } from "../../todos";

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

/** 確定済みデータへ未完了mutationを重ねる。共有キャッシュの全体rollbackはしない。 */
function applyChanges(
  home: TaskOverviewResponse,
  changes: CompletionChange[],
): TaskOverviewResponse {
  const byTask = new Map<string, CompletionChange[]>();
  for (const change of changes) {
    if (home.today !== change.targetDate) continue;
    const taskChanges = byTask.get(change.taskId);
    if (taskChanges) taskChanges.push(change);
    else byTask.set(change.taskId, [change]);
  }
  if (byTask.size === 0) return home;

  let dailyChanged = false;
  const dailyTasks = home.dailyTasks.map((item) => {
    const taskChanges = byTask.get(item.task.id);
    if (!taskChanges) return item;
    let completedToday = item.completedToday;
    let completedBy = item.completedBy;
    for (const change of taskChanges) {
      completedToday = change.completed;
      completedBy = completedToday ? (completedBy ?? change.actor) : null;
    }
    if (completedToday === item.completedToday && completedBy === item.completedBy) return item;
    dailyChanged = true;
    return { ...item, completedToday, completedBy };
  });

  let weeklyChanged = false;
  const weeklyTasks = home.weeklyTasks.map((item) => {
    const taskChanges = byTask.get(item.task.id);
    if (!taskChanges) return item;
    let weekCompletedCount = item.weekCompletedCount;
    let completionSlots = item.completionSlots;
    for (const change of taskChanges) {
      weekCompletedCount =
        change.action === "increment" || change.action === "decrement"
          ? Math.max(
              0,
              Math.min(
                item.requiredCompletionsPerWeek,
                weekCompletedCount + (change.action === "increment" ? 1 : -1),
              ),
            )
          : change.count;
      let slotsChanged = false;
      const nextSlots = completionSlots.map((slot) => {
        const actor = slot.slot <= weekCompletedCount ? (slot.actor ?? change.actor) : null;
        if (actor === slot.actor) return slot;
        slotsChanged = true;
        return { ...slot, actor };
      });
      if (slotsChanged) completionSlots = nextSlots;
    }
    if (weekCompletedCount === item.weekCompletedCount && completionSlots === item.completionSlots)
      return item;
    weeklyChanged = true;
    return { ...item, weekCompletedCount, completionSlots };
  });
  return dailyChanged || weeklyChanged
    ? {
        ...home,
        dailyTasks: dailyChanged ? dailyTasks : home.dailyTasks,
        weeklyTasks: weeklyChanged ? weeklyTasks : home.weeklyTasks,
      }
    : home;
}

/** UIのタップをAPIの希望状態に変換する。複数回の週間タスクだけは加減算を送る。 */
function completionChange(
  home: TaskOverviewResponse,
  intent: CompletionIntent,
  actor?: TaskCompletionActor,
): CompletionChange | undefined {
  const common = { taskId: intent.taskId, targetDate: dateStringInJST(), actor };
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

export const homeTodoItemsQueryOptions = todoItemsQueryOptions;

export const previousMonthPenaltySummaryQueryOptions = () =>
  monthlyPenaltySummaryQueryOptions(previousMonthKey(dateStringInJST().slice(0, 7)));

export function useHomePageQueries() {
  const pendingCompletions = usePendingCompletions();
  const previousMonth = previousMonthKey(dateStringInJST().slice(0, 7));
  const [homeQuery, todoItemsQuery, previousMonthPenaltySummaryQuery, penaltyRulesQuery] =
    useSuspenseQueries({
      queries: [
        homeQueryOptions,
        homeTodoItemsQueryOptions,
        monthlyPenaltySummaryQueryOptions(previousMonth),
        penaltyRulesWithDeletedQueryOptions,
      ],
    });

  const todoItems = useOptimisticTodoItems(todoItemsQuery.data);

  return {
    homeQuery: {
      data: applyChanges(homeQuery.data, pendingCompletions),
      isSuccess: homeQuery.isSuccess,
    },
    todoItemsQuery: {
      data: todoItems,
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
        (home) => home && applyChanges(home, [{ ...change, completed: data.completed }]),
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
    toggleAllDaily: () => {
      const home = queryClient.getQueryData<TaskOverviewResponse>(queryKeys.home);
      if (!home || home.dailyTasks.length === 0) return;
      const targetDate = dateStringInJST();
      if (home.today !== targetDate) {
        setStatus("日付が変わりました。最新のタスクを読み込み直しています。");
        void queryClient.invalidateQueries({ queryKey: queryKeys.home });
        return;
      }
      const dailyTaskIds = new Set(home.dailyTasks.map((item) => item.task.id));
      // 再描画前の連打や個別操作との競合も、送信直前のpending確認で防ぐ。
      if (
        queryClient.isMutating({
          mutationKey: completionMutationKey,
          predicate: (item) => dailyTaskIds.has((item.state.variables as CompletionChange).taskId),
        }) > 0
      )
        return;

      const completed = home.dailyTasks.some((item) => !item.completedToday);
      for (const item of home.dailyTasks) {
        if (item.completedToday === completed) continue;
        mutation.mutate({
          taskId: item.task.id,
          action: completed ? "complete" : "incomplete",
          targetDate,
          actor,
          completed,
          count: 0,
        });
      }
    },
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
