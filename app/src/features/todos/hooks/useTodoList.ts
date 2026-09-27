import {
  useMutation,
  useMutationState,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import {
  type CreateTodoItemRequest,
  deleteTodoItem,
  listTodoItems,
  patchTodoItem,
  postTodoItem,
  postTodoItemsReorder,
  type ReorderTodoItemsRequest,
  type TodoItem,
  type TodoCategoryOrder,
  type UpdateTodoItemRequest,
} from "../../../lib/api/operations";
import { queryKeys } from "../../../shared/query/queryKeys";
import { formatError } from "../../../shared/utils/errors";

type StatusSetter = (message: string) => void;
const removeMutationKey = ["todo-remove"];

export function usePendingTodoRemovals() {
  return useMutationState({
    filters: { mutationKey: removeMutationKey, status: "pending" },
    select: (mutation) => mutation.state.variables as string,
  });
}

export function useTodoItemsQuery() {
  const pendingIds = usePendingTodoRemovals();
  const query = useSuspenseQuery({
    queryKey: queryKeys.todoItems,
    queryFn: async ({ signal }) => (await listTodoItems({ signal })).data.items,
  });
  return { ...query, data: query.data.filter((item) => !pendingIds.includes(item.id)) };
}

export function useTodoItemMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.todoItems });
  };

  const refreshNewCategory = (category: string | null) => {
    if (
      category != null &&
      !queryClient.getQueryData<TodoCategoryOrder>(queryKeys.todoCategories)?.includes(category)
    ) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.todoCategories });
    }
  };

  const createItem = useMutation({
    mutationFn: async (payload: CreateTodoItemRequest) => postTodoItem(payload),
    onSuccess: async (response) => {
      refreshNewCategory(response.data.category);
      setStatus("ToDoを追加しました");
      await queryClient.cancelQueries({ queryKey: queryKeys.todoItems });
      const createdItem = response.data;
      queryClient.setQueryData<TodoItem[]>(queryKeys.todoItems, (current) => [
        createdItem,
        ...(current ?? []).filter((item) => item.id !== createdItem.id),
      ]);
    },
    onError: (error) => {
      setStatus(`ToDoの追加に失敗しました: ${formatError(error)}`);
    },
  });

  const updateItem = useMutation({
    mutationFn: async ({ itemId, payload }: { itemId: string; payload: UpdateTodoItemRequest }) =>
      patchTodoItem(itemId, payload),
    onSuccess: async ({ data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todoItems });
      queryClient.setQueryData<TodoItem[]>(queryKeys.todoItems, (items) =>
        items?.map((item) => (item.id === data.id ? data : item)),
      );
      refreshNewCategory(data.category);
      setStatus("ToDoを更新しました");
    },
    onError: (error) => {
      setStatus(`ToDoの更新に失敗しました: ${formatError(error)}`);
    },
  });

  const removeItem = useMutation({
    mutationKey: removeMutationKey,
    mutationFn: async (itemId: string) => deleteTodoItem(itemId),
    onSuccess: async (_, itemId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todoItems });
      queryClient.setQueryData<TodoItem[]>(queryKeys.todoItems, (items) =>
        items?.filter((item) => item.id !== itemId),
      );
      setStatus("ToDoを削除しました");
    },
    onError: (error) => {
      setStatus(`ToDoの削除に失敗しました: ${formatError(error)}`);
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: removeMutationKey }) === 1) void invalidate();
    },
  });

  const reorderItems = useMutation({
    mutationFn: async (payload: ReorderTodoItemsRequest) => {
      const response = await postTodoItemsReorder(payload);
      return response.data.items;
    },
    onSuccess: (items) => {
      queryClient.setQueryData<TodoItem[]>(queryKeys.todoItems, items);
      setStatus("並び順を更新しました");
    },
    onError: (error) => {
      void invalidate();
      setStatus(`並び順の更新に失敗しました: ${formatError(error)}`);
    },
  });

  return { createItem, updateItem, removeItem, reorderItems };
}
