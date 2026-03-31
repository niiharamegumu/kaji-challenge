import { useAtom } from "jotai";
import { useState } from "react";

import {
  type CreateTaskRequest,
  TaskType as TaskTypeConst,
  type UpdateTaskRequest,
} from "../../../lib/api/generated/client";
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
  const tasksQuery = useTasksQuery();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [taskForm, setTaskForm] = useAtom(taskFormAtom);
  const [, setStatus] = useAtom(statusMessageAtom);
  const { createTask, removeTask, updateTask, reorderTasks } =
    useTaskMutations(setStatus);

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
        tasks={tasksQuery.data}
        isCreateOpen={isCreateOpen}
        isReordering={reorderTasks.isPending}
        onCloseCreate={() => setIsCreateOpen(false)}
        onFormChange={(updater) => setTaskForm((prev) => updater(prev))}
        onOpenCreate={() => setIsCreateOpen(true)}
        onCreate={handleCreateTask}
        onDelete={(taskId) => {
          void removeTask.mutateAsync(taskId);
        }}
        onReorder={(payload) => {
          void reorderTasks.mutateAsync(payload);
        }}
        onUpdate={handleUpdateTask}
      />
    </section>
  );
}
