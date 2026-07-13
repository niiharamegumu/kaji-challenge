import {
  getPenaltySummaryMonthly,
  listPenaltyRules,
  postTaskCompletionToggle,
} from "../../../lib/api/generated/client";

export async function getMonthlyPenaltySummary(month: string) {
  return (await getPenaltySummaryMonthly({ month })).data;
}

export async function listPenaltyRulesWithDeleted() {
  return (await listPenaltyRules({ includeDeleted: true })).data.items;
}

export async function completePastDailyTask(
  taskId: string,
  targetDate: string,
) {
  await postTaskCompletionToggle(taskId, {
    targetDate,
    action: "complete",
  });
}

export async function incrementPastWeeklyTask(
  taskId: string,
  targetDate: string,
) {
  await postTaskCompletionToggle(taskId, {
    targetDate,
    action: "increment",
  });
}

export async function decrementPastDailyTask(
  taskId: string,
  targetDate: string,
) {
  await postTaskCompletionToggle(taskId, {
    targetDate,
    action: "decrement",
  });
}

export async function decrementPastWeeklyTask(
  taskId: string,
  targetDate: string,
) {
  await postTaskCompletionToggle(taskId, {
    targetDate,
    action: "decrement",
  });
}
