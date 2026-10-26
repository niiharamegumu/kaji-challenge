import {
  useSuspenseQuery,
  useMutation,
  useMutationState,
  useIsMutating,
  useQueryClient,
} from "@tanstack/react-query";
import {
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
import { formatError } from "../../../shared/utils/errors";
import { tasksQueryOptions } from "../../../shared/query/taskQueries";
export { tasksQueryOptions } from "../../../shared/query/taskQueries";
const reorderMutationKey = ["task-reorder"];

export function useTasksQuery() {
  const query = useSuspenseQuery(tasksQueryOptions);
  const orders = useMutationState({
    filters: { mutationKey: reorderMutationKey, status: "pending" },
    select: (mutation) => mutation.state.variables as ReorderTasksRequest,
  });
  const order = orders.at(-1);
  if (!order) return { data: query.data };
  const byId = new Map(query.data.map((task) => [task.id, task]));
  const ordered = order.taskIds.flatMap((id) => {
    const task = byId.get(id);
    return task ? [task] : [];
  });
  const ids = new Set(order.taskIds);
  let index = 0;
  // Keep new tasks in place and never restore tasks deleted during the request.
  return { data: query.data.map((task) => (ids.has(task.id) ? ordered[index++] : task)) };
}

type StatusSetter = (message: string) => void;

export function useTaskMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();
  const isReordering = useIsMutating({ mutationKey: reorderMutationKey }) > 0;

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
      setStatus(`タスク更新に失敗しました: ${formatError(error)}`);
    },
  });

  const reorderTasks = useMutation({
    mutationKey: reorderMutationKey,
    onMutate: () => queryClient.cancelQueries({ queryKey: queryKeys.tasks }),
    mutationFn: async (payload: ReorderTasksRequest) => {
      const response = await postTasksReorder(payload);
      return response.data.items;
    },
    onSuccess: async (items, payload) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
      queryClient.setQueryData<Task[]>(queryKeys.tasks, (current) => {
        if (current == null) {
          return items;
        }
        const byId = new Map(current.map((item) => [item.id, item]));
        const ids = new Set(items.map((item) => item.id));
        const requested = new Set(payload.taskIds);
        const reordered = items.flatMap((item) => {
          const saved = byId.get(item.id);
          return saved
            ? [{ ...saved, sortKey: item.sortKey }]
            : requested.has(item.id)
              ? []
              : [item];
        });
        const daily: Task[] = [];
        const weekly: Task[] = [];
        // The response already has saved order. Preserve concurrent additions/edits/deletions
        // and group the two task types without sorting the whole list again.
        for (const item of current) {
          if (!ids.has(item.id)) (item.type === "daily" ? daily : weekly).push(item);
        }
        for (const item of reordered) (item.type === "daily" ? daily : weekly).push(item);
        return [...daily, ...weekly];
      });
      setStatus("並び順を更新しました");
    },
    onError: async (error) => {
      void invalidate();
      setStatus(`並び順の更新に失敗しました: ${formatError(error)}`);
    },
  });

  const reorder: typeof reorderTasks.mutate = (payload, options) => {
    // Mutation state changes synchronously, before a second drag can reuse the old render.
    if (queryClient.isMutating({ mutationKey: reorderMutationKey }) > 0) return;
    reorderTasks.mutate(payload, options);
  };

  return {
    createTask,
    removeTask,
    updateTask,
    reorderTasks: { ...reorderTasks, isPending: isReordering, mutate: reorder },
  };
}
