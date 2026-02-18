import { useAtom, useAtomValue } from "jotai";

import {
  type CreateTaskRequest,
  TaskType as TaskTypeConst,
} from "../../../lib/api/generated/client";
import { isLoggedInAtom } from "../../../state/session";
import { statusMessageAtom } from "../../shell/state/status";
import { TaskManager } from "../components/TaskManager";
import { useTaskMutations } from "../hooks/useAdminMutations";
import { useTasksQuery } from "../hooks/useAdminQueries";
import { taskFormAtom } from "../state/forms";

export function AdminTasksPage() {
  const loggedIn = useAtomValue(isLoggedInAtom);
  const tasksQuery = useTasksQuery(loggedIn);

  const [taskForm, setTaskForm] = useAtom(taskFormAtom);
  const [, setStatus] = useAtom(statusMessageAtom);
  const { createTask, toggleTask, removeTask } = useTaskMutations(setStatus);

  const handleCreateTask = async () => {
    const payload: CreateTaskRequest = {
      title: taskForm.title,
      notes: taskForm.notes === "" ? undefined : taskForm.notes,
      type: taskForm.type,
      penaltyPoints: Number(taskForm.penaltyPoints),
      requiredCompletionsPerWeek:
        taskForm.type === TaskTypeConst.weekly
          ? Number(taskForm.requiredCompletionsPerWeek)
          : undefined,
    };
    await createTask.mutateAsync(payload);
  };

  return (
    <section className="mt-4 w-full pb-2">
      <TaskManager
        form={taskForm}
        tasks={tasksQuery.data ?? []}
        onFormChange={(updater) => setTaskForm((prev) => updater(prev))}
        onCreate={() => {
          void handleCreateTask();
        }}
        onToggleActive={(taskId, isActive) => {
          void toggleTask.mutateAsync({ taskId, isActive });
        }}
        onDelete={(taskId) => {
          void removeTask.mutateAsync(taskId);
        }}
      />
    </section>
  );
}
