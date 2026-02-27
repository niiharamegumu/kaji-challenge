import { useAtom, useAtomValue } from "jotai";

import {
  type CreateTaskRequest,
  TaskType as TaskTypeConst,
  type UpdateTaskRequest,
} from "../../../lib/api/generated/client";
import { isLoggedInAtom } from "../../../state/session";
import { statusMessageAtom } from "../../shell/state/status";
import { TaskManager } from "../components/TaskManager";
import {
  WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MAX,
  WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MIN,
} from "../constants/tasks";
import { useTaskMutations } from "../hooks/useAdminMutations";
import { useTasksQuery } from "../hooks/useAdminQueries";
import { initialTaskFormState, taskFormAtom } from "../state/forms";

export function AdminTasksPage() {
  const loggedIn = useAtomValue(isLoggedInAtom);
  const tasksQuery = useTasksQuery(loggedIn);

  const [taskForm, setTaskForm] = useAtom(taskFormAtom);
  const [, setStatus] = useAtom(statusMessageAtom);
  const { createTask, removeTask, updateTask } = useTaskMutations(setStatus);

  const handleCreateTask = async () => {
    let requiredCompletionsPerWeek: number | undefined;
    if (taskForm.type === TaskTypeConst.weekly) {
      const parsed = Number(taskForm.requiredCompletionsPerWeek);
      if (
        !Number.isInteger(parsed) ||
        parsed < WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MIN ||
        parsed > WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MAX
      ) {
        setStatus(
          `週間必要回数は${WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MIN}〜${WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MAX}の整数で入力してください`,
        );
        return;
      }
      requiredCompletionsPerWeek = parsed;
    }

    const payload: CreateTaskRequest = {
      title: taskForm.title,
      notes: taskForm.notes === "" ? undefined : taskForm.notes,
      type: taskForm.type,
      penaltyPoints: Number(taskForm.penaltyPoints),
      requiredCompletionsPerWeek,
    };
    await createTask.mutateAsync(payload);
    setTaskForm(initialTaskFormState);
  };

  const handleUpdateTask = async (
    taskId: string,
    payload: UpdateTaskRequest,
  ) => {
    await updateTask.mutateAsync({ taskId, payload });
  };

  return (
    <section className="mt-2 w-full pb-1 md:mt-4">
      <TaskManager
        form={taskForm}
        tasks={tasksQuery.data ?? []}
        onFormChange={(updater) => setTaskForm((prev) => updater(prev))}
        onCreate={() => {
          void handleCreateTask();
        }}
        onDelete={(taskId) => {
          void removeTask.mutateAsync(taskId);
        }}
        onUpdate={handleUpdateTask}
      />
    </section>
  );
}
