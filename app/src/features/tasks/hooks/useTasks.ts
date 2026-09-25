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
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
      setStatus("タスクを作成しました");
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
      void Promise.all([
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
    onSuccess: async (_, taskId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
      queryClient.setQueryData<Task[]>(queryKeys.tasks, (items) =>
        items?.filter((item) => item.id !== taskId),
      );
      setStatus("タスクを削除しました");
      void invalidate();
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
    onSuccess: async ({ data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
      queryClient.setQueryData<Task[]>(queryKeys.tasks, (items) =>
        items?.map((item) => (item.id === data.id ? data : item)),
      );
      setStatus("タスクを更新しました");
      void invalidate();
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
      return response.data.items;
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
