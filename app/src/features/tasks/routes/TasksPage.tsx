import { useAtom } from "jotai";
import { Plus } from "lucide-react";
import { useState } from "react";

import type { UpdateTaskRequest } from "../../../lib/api/operations";
import { FooterQuickAction } from "../../../shared/components/FooterQuickAction";
import { statusMessageAtom } from "../../../shared/state/status";
import { TaskCreateForm, TaskManager } from "../components/TaskManager";
import { useTaskMutations, useTasksQuery } from "../hooks/useTasks";
import { buildCreateTaskRequest, canSubmitTaskForm } from "../model/tasks";
import { initialTaskFormState, taskFormAtom } from "../state/forms";

export function TasksPage() {
  const tasksQuery = useTasksQuery();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [taskForm, setTaskForm] = useAtom(taskFormAtom);
  const [, setStatus] = useAtom(statusMessageAtom);
  const { createTask, removeTask, updateTask, reorderTasks } = useTaskMutations(setStatus);

  const handleCreateTask = async () => {
    const payload = buildCreateTaskRequest(taskForm);
    if ("error" in payload) {
      setStatus(payload.error);
      return;
    }
    await createTask.mutateAsync(payload);
    setTaskForm(initialTaskFormState);
  };

  const handleUpdateTask = async (taskId: string, payload: UpdateTaskRequest) => {
    await updateTask.mutateAsync({ taskId, payload });
  };

  return (
    <section className="mt-2 w-full pb-1 md:mt-4">
      <TaskManager
        form={taskForm}
        tasks={tasksQuery.data}
        isCreateOpen={false}
        isCreating={createTask.isPending}
        createFailed={createTask.isError}
        isUpdating={updateTask.isPending}
        isReordering={reorderTasks.isPending}
        showCreateButton={false}
        onCloseCreate={() => setIsCreateOpen(false)}
        onFormChange={(updater) => setTaskForm((prev) => updater(prev))}
        onOpenCreate={() => {
          createTask.reset();
          setIsCreateOpen(true);
        }}
        onCreate={handleCreateTask}
        onDelete={(taskId) => {
          removeTask.mutate(taskId);
        }}
        onReorder={(payload) => {
          reorderTasks.mutate(payload);
        }}
        onUpdate={handleUpdateTask}
      />
      <FooterQuickAction
        isOpen={isCreateOpen}
        isSubmitting={createTask.isPending}
        submitFailed={createTask.isError}
        title="タスクを追加"
        submitLabel="追加する"
        submitIcon={<Plus size={16} aria-hidden="true" />}
        submitDisabled={!canSubmitTaskForm(taskForm)}
        onOpen={() => {
          createTask.reset();
          setIsCreateOpen(true);
        }}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={() => {
          return handleCreateTask().then(() => {
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
