import { useAtom } from "jotai";
import { Plus } from "lucide-react";
import { useState } from "react";

import type { UpdateTaskRequest } from "../../../lib/api/generated/client";
import { FooterQuickAction } from "../../../shared/components/FooterQuickAction";
import { statusMessageAtom } from "../../../shared/state/status";
import { TaskCreateForm, TaskManager } from "../components/TaskManager";
import { useTaskMutations } from "../hooks/useAdminMutations";
import { useTasksQuery } from "../hooks/useAdminQueries";
import { buildCreateTaskRequest, canSubmitTaskForm } from "../model/tasks";
import { initialTaskFormState, taskFormAtom } from "../state/forms";

export function AdminTasksPage() {
  const tasksQuery = useTasksQuery();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [taskForm, setTaskForm] = useAtom(taskFormAtom);
  const [, setStatus] = useAtom(statusMessageAtom);
  const { createTask, removeTask, updateTask, reorderTasks } =
    useTaskMutations(setStatus);

  const handleCreateTask = async () => {
    const payload = buildCreateTaskRequest(taskForm);
    if ("error" in payload) {
      setStatus(payload.error);
      return;
    }
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
        isCreateOpen={false}
        isReordering={reorderTasks.isPending}
        showCreateButton={false}
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
      <FooterQuickAction
        isOpen={isCreateOpen}
        title="タスクを追加"
        submitLabel="追加する"
        submitIcon={<Plus size={16} aria-hidden="true" />}
        submitDisabled={!canSubmitTaskForm(taskForm)}
        onOpen={() => setIsCreateOpen(true)}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={() => {
          void handleCreateTask().then(() => {
            setIsCreateOpen(false);
          });
        }}
      >
        <TaskCreateForm
          form={taskForm}
          onFormChange={(updater) => setTaskForm((prev) => updater(prev))}
        />
      </FooterQuickAction>
    </section>
  );
}
