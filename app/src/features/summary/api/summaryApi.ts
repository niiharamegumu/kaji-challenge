import { postTaskCompletion } from "../../../lib/api/operations";

export async function completePastDailyTask(taskId: string, targetDate: string) {
  await postTaskCompletion(taskId, {
    targetDate,
    action: "complete",
  });
}

export async function incrementPastWeeklyTask(taskId: string, targetDate: string) {
  await postTaskCompletion(taskId, {
    targetDate,
    action: "increment",
  });
}

export async function decrementPastDailyTask(taskId: string, targetDate: string) {
  await postTaskCompletion(taskId, {
    targetDate,
    action: "incomplete",
  });
}

export async function decrementPastWeeklyTask(taskId: string, targetDate: string) {
  await postTaskCompletion(taskId, {
    targetDate,
    action: "decrement",
  });
}
