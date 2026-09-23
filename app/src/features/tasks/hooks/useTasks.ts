import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listTasks,
  type CreateTaskRequest,
  deleteTask,
  patchTask,
  postTask,
  postTasksReorder,
  type ReorderTasksRequest,
  type Task,
  type UpdateTaskRequest,
} from "../../../lib/api/operations";
import { queryKeys } from "../../../shared/query/queryKeys";
import { handleTeamStatePreconditionFailure } from "../../../shared/query/teamStateRefresh";
import { formatError } from "../../../shared/utils/errors";

export function useTasksQuery() {
  return useSuspenseQuery({
    queryKey: queryKeys.tasks,
    queryFn: async () => (await listTasks()).data.items,
  });
}

type StatusSetter = (message: string) => void;

export function useTaskMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();
  const hasTasks = (value: unknown): value is { items?: Task[] } =>
    value != null && typeof value === "object" && "items" in value;
  const hasTaskId = (value: unknown): value is Task =>
    value != null && typeof value === "object" && "id" in value && typeof value.id === "string";

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary }),
    ]);
  };

  const createTask = useMutation({
    mutationFn: async (payload: CreateTaskRequest) => postTask(payload),
    onSuccess: async (response) => {
      setStatus("タスクを作成しました");
      if (!hasTaskId(response.data)) {
        await invalidate();
        return;
      }
      const createdTask = response.data;
      queryClient.setQueryData<Task[]>(queryKeys.tasks, (current) => {
        const tasks = (current ?? []).filter((task) => task.id !== createdTask.id);
        const sameTypeIndex = tasks.findIndex((task) => task.type === createdTask.type);
        const insertIndex =
          sameTypeIndex >= 0
            ? sameTypeIndex
            : tasks.findIndex((task) => task.type.localeCompare(createdTask.type) > 0);
        if (insertIndex < 0) {
          return [...tasks, createdTask];
        }
        return [...tasks.slice(0, insertIndex), createdTask, ...tasks.slice(insertIndex)];
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary }),
      ]);
    },
    onError: async (error) => {
      if (await handleTeamStatePreconditionFailure(error, queryClient, setStatus)) {
        return;
      }
      setStatus(`タスク作成に失敗しました: ${formatError(error)}`);
    },
  });

  const removeTask = useMutation({
    mutationFn: async (taskId: string) => deleteTask(taskId),
    onSuccess: async () => {
      setStatus("タスクを削除しました");
      await invalidate();
    },
    onError: async (error) => {
      if (await handleTeamStatePreconditionFailure(error, queryClient, setStatus)) {
        return;
      }
      setStatus(`タスク削除に失敗しました: ${formatError(error)}`);
    },
  });

  const updateTask = useMutation({
    mutationFn: async ({ taskId, payload }: { taskId: string; payload: UpdateTaskRequest }) =>
      patchTask(taskId, payload),
    onSuccess: async () => {
      setStatus("タスクを更新しました");
      await invalidate();
    },
    onError: async (error) => {
      if (await handleTeamStatePreconditionFailure(error, queryClient, setStatus)) {
        return;
      }
      setStatus(`タスク更新に失敗しました: ${formatError(error)}`);
    },
  });

  const reorderTasks = useMutation({
    mutationFn: async (payload: ReorderTasksRequest) => {
      const response = await postTasksReorder(payload);
      if (!hasTasks(response.data)) {
        throw new Error("unexpected task reorder response");
      }
      return response.data.items ?? [];
    },
    onSuccess: (items) => {
      queryClient.setQueryData<Task[]>(queryKeys.tasks, (current) => {
        if (current == null) {
          return items;
        }
        const reorderedIds = new Set(items.map((item) => item.id));
        const untouchedItems = current.filter((item) => !reorderedIds.has(item.id));
        return [...untouchedItems, ...items].sort((left, right) => {
          if (left.type !== right.type) {
            return left.type.localeCompare(right.type);
          }
          if (left.sortKey !== right.sortKey) {
            return left.sortKey - right.sortKey;
          }
          if (left.createdAt !== right.createdAt) {
            return left.createdAt.localeCompare(right.createdAt);
          }
          return left.id.localeCompare(right.id);
        });
      });
      setStatus("並び順を更新しました");
    },
    onError: async (error) => {
      if (await handleTeamStatePreconditionFailure(error, queryClient, setStatus)) {
        return;
      }
      void invalidate();
      setStatus(`並び順の更新に失敗しました: ${formatError(error)}`);
    },
  });

  return { createTask, removeTask, updateTask, reorderTasks };
}
