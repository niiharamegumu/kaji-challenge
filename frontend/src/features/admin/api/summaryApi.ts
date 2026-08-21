import { postTaskCompletionToggle } from "../../../lib/api/generated/client";

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
