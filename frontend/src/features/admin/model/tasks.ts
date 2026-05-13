import {
  type CreateTaskRequest,
  TaskType as GeneratedTaskType,
  type TaskType,
} from "../../../lib/api/generated/client";
import {
  WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MAX,
  WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MIN,
} from "../constants/tasks";
import type { TaskFormState } from "../state/forms";

export type { TaskType };

export const TaskTypeConst = GeneratedTaskType;

export function isWeeklyTaskType(type: TaskType) {
  return type === TaskTypeConst.weekly;
}

export function getWeeklyRequiredCompletionsError(value: string) {
  const parsed = Number(value);
  if (
    Number.isInteger(parsed) &&
    parsed >= WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MIN &&
    parsed <= WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MAX
  ) {
    return null;
  }
  return `週間必要回数は${WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MIN}〜${WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MAX}の整数で入力してください`;
}

export function canSubmitTaskForm(form: TaskFormState) {
  return (
    form.title.trim().length > 0 &&
    (!isWeeklyTaskType(form.type) ||
      getWeeklyRequiredCompletionsError(form.requiredCompletionsPerWeek) ==
        null)
  );
}

export function buildCreateTaskRequest(
  form: TaskFormState,
): CreateTaskRequest | { error: string } {
  let requiredCompletionsPerWeek: number | undefined;
  if (isWeeklyTaskType(form.type)) {
    const error = getWeeklyRequiredCompletionsError(
      form.requiredCompletionsPerWeek,
    );
    if (error != null) {
      return { error };
    }
    requiredCompletionsPerWeek = Number(form.requiredCompletionsPerWeek);
  }

  return {
    title: form.title,
    notes: form.notes === "" ? undefined : form.notes,
    type: form.type,
    penaltyPoints: Number(form.penaltyPoints),
    requiredCompletionsPerWeek,
  };
}
