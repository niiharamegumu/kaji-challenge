import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import type {
  MonthlyPenaltySummary,
  MonthlyTaskStatusItem,
  TaskCompletionActor,
  TaskCompletionRequest,
} from "../../../lib/api/operations";
import { queryKeys } from "../../../shared/query/queryKeys";
import { formatError } from "../../../shared/utils/errors";
import { updatePastTaskCompletion } from "../api/summaryApi";

export type PastTaskUpdate = {
  taskId: string;
  targetDate: string;
  type: "daily" | "weekly";
  action: TaskCompletionRequest["action"];
};
type CompletionChange = PastTaskUpdate & { month: string; actor: TaskCompletionActor };
const mutationKey = ["summary-task-completion"];
const actionId = (target: Omit<PastTaskUpdate, "action">) =>
  `${target.type}:${target.taskId}:${target.targetDate}`;
const isStateChange = (change: PastTaskUpdate) =>
  change.action === "complete" || change.action === "incomplete";
const completedCount = (item: MonthlyTaskStatusItem) =>
  item.completed
    ? item.completionSlots.length
    : item.completionSlots.filter((slot) => slot.actor != null).length;

function applyItemChange(item: MonthlyTaskStatusItem, change: CompletionChange) {
  const required = item.completionSlots.length;
  const count = isStateChange(change)
    ? change.action === "complete"
      ? required
      : 0
    : Math.max(
        0,
        Math.min(required, completedCount(item) + (change.action === "increment" ? 1 : -1)),
      );
  let slotsChanged = false;
  const completionSlots = item.completionSlots.map((slot) => {
    const actor = slot.slot <= count ? (slot.actor ?? change.actor) : null;
    if (actor === slot.actor) return slot;
    slotsChanged = true;
    return { ...slot, actor };
  });
  const completed = count >= required;
  return completed === item.completed && !slotsChanged
    ? item
    : {
        ...item,
        completed,
        completionSlots: slotsChanged ? completionSlots : item.completionSlots,
      };
}

function applyChanges(summary: MonthlyPenaltySummary, changes: CompletionChange[]) {
  const byDate = new Map<string, Map<string, CompletionChange[]>>();
  for (const change of changes) {
    let byTask = byDate.get(change.targetDate);
    if (!byTask) {
      byTask = new Map();
      byDate.set(change.targetDate, byTask);
    }
    const key = `${change.type}:${change.taskId}`;
    const taskChanges = byTask.get(key);
    if (taskChanges) taskChanges.push(change);
    else byTask.set(key, [change]);
  }
  if (byDate.size === 0) return summary;

  let changed = false;
  const taskStatusByDate = summary.taskStatusByDate.map((group) => {
    const byTask = byDate.get(group.date);
    if (!byTask) return group;
    let itemsChanged = false;
    const items = group.items.map((item) => {
      const taskChanges = byTask.get(`${item.type}:${item.taskId}`);
      const updated = taskChanges ? taskChanges.reduce(applyItemChange, item) : item;
      if (updated !== item) itemsChanged = true;
      return updated;
    });
    if (!itemsChanged) return group;
    changed = true;
    return { ...group, items };
  });
  return changed ? { ...summary, taskStatusByDate } : summary;
}

export function usePastTaskCompletion(
  month: string,
  summary: MonthlyPenaltySummary,
  actor: TaskCompletionActor | undefined,
  setStatus: (message: string) => void,
) {
  const queryClient = useQueryClient();
  const pending = useMutationState({
    filters: { mutationKey, status: "pending" },
    select: (mutation) => mutation.state.variables as CompletionChange,
  });
  const mutation = useMutation({
    mutationKey,
    onMutate: () => queryClient.cancelQueries({ queryKey: queryKeys.monthlySummary }),
    mutationFn: ({ taskId, targetDate, action }: CompletionChange) =>
      updatePastTaskCompletion(taskId, { targetDate, action }),
    onSuccess: async ({ data }, change) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.monthlySummary });
      // Apply the successful delta, not an absolute weekly count from an older response.
      const saved = isStateChange(change)
        ? { ...change, action: data.completed ? ("complete" as const) : ("incomplete" as const) }
        : change;
      queryClient.setQueryData<MonthlyPenaltySummary>(
        [...queryKeys.monthlySummary, change.month],
        (current) => current && applyChanges(current, [saved]),
      );
    },
    onError: (error) => setStatus(`更新失敗: ${formatError(error)}`),
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey }) === 1) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary });
        void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      }
    },
  });

  const monthPending = pending.filter((change) => change.month === month);
  const savingTargets = new Set(monthPending.filter(isStateChange).map(actionId));
  return {
    data: applyChanges(summary, monthPending),
    isSaving: (target: Omit<PastTaskUpdate, "action">) => savingTargets.has(actionId(target)),
    update: (target: PastTaskUpdate) => {
      const saved = queryClient.getQueryData<MonthlyPenaltySummary>([
        ...queryKeys.monthlySummary,
        month,
      ]);
      if (!saved || !actor) return;
      // Read pending operations synchronously so rapid taps respect the visible count.
      const inFlight = queryClient
        .getMutationCache()
        .findAll({ mutationKey, status: "pending" })
        .map((entry) => entry.state.variables as CompletionChange)
        .filter((change) => change.month === month && actionId(change) === actionId(target));
      const savedItem = saved.taskStatusByDate
        .find((group) => group.date === target.targetDate)
        ?.items.find((entry) => entry.taskId === target.taskId && entry.type === target.type);
      if (!savedItem) return;
      const item = inFlight.reduce(applyItemChange, savedItem);

      const single = item.type === "daily" || item.completionSlots.length === 1;
      let action = target.action;
      if (single) {
        if (inFlight.length > 0) return;
        action = action === "complete" || action === "increment" ? "complete" : "incomplete";
        if (item.completed === (action === "complete")) return;
      } else {
        const count = completedCount(item);
        if (action === "increment" && count >= item.completionSlots.length) return;
        if (action === "decrement" && count <= 0) return;
      }
      mutation.mutate({ ...target, action, month, actor });
    },
  };
}
