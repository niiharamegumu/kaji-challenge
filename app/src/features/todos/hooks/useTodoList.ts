import { todoItemsQueryOptions } from "../../../shared/query/todoQueries";
import {
  useIsMutating,
  useMutation,
  useMutationState,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import {
  type CreateTodoItemRequest,
  deleteTodoItem,
  patchTodoItem,
  postTodoItem,
  postTodoItemsReorder,
  type ReorderTodoItemsRequest,
  type TodoItem,
  type UpdateTodoItemRequest,
} from "../../../lib/api/operations";
import { isApiRequestError } from "../../../lib/api/api-client-state";
import { queryKeys } from "../../../shared/query/queryKeys";
import { formatError } from "../../../shared/utils/errors";

type StatusSetter = (message: string) => void;
export const createTodoItemMutationKey = ["todo-create"];
const removeMutationKey = ["todo-remove"];
const updateMutationKey = ["todo-update"];
const reorderMutationKey = ["todo-reorder"];
type TodoUpdate = { itemId: string; payload: UpdateTodoItemRequest };

/** 確定キャッシュを保持し、画面をまたいで保存中の編集・順序・完了を共有する。 */
export function useOptimisticTodoItems(items: TodoItem[]) {
  const removed = new Set(usePendingTodoRemovals());
  const updates = useMutationState({
    filters: { mutationKey: updateMutationKey, status: "pending" },
    select: (mutation) => mutation.state.variables as TodoUpdate,
  });
  const orders = useMutationState({
    filters: { mutationKey: reorderMutationKey, status: "pending" },
    select: (mutation) => mutation.state.variables as ReorderTodoItemsRequest,
  });
  let result = items;
  for (const { itemId, payload } of updates) {
    result = result.map((item) =>
      item.id === itemId
        ? {
            ...item,
            name: payload.name ?? item.name,
            notes: payload.notes === undefined ? item.notes : payload.notes,
            categoryId: payload.categoryId === undefined ? item.categoryId : payload.categoryId,
          }
        : item,
    );
  }
  const order = orders.at(-1);
  if (order) {
    const byId = new Map(result.map((item) => [item.id, item]));
    const ordered = order.itemIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
    const ids = new Set(order.itemIds);
    let index = 0;
    // 並べ替え中に追加された項目の位置は保持し、削除された項目は復活させない。
    result = result.map((item) => (ids.has(item.id) ? ordered[index++] : item));
  }
  return result.filter((item) => !removed.has(item.id));
}

export function usePendingTodoRemovals() {
  return useMutationState({
    filters: { mutationKey: removeMutationKey, status: "pending" },
    select: (mutation) => mutation.state.variables as string,
  });
}

export function useTodoItemsQuery() {
  const query = useSuspenseQuery(todoItemsQueryOptions);
  const data = useOptimisticTodoItems(query.data);
  return { ...query, data };
}

export function useTodoItemMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();
  const isReordering = useIsMutating({ mutationKey: reorderMutationKey }) > 0;

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.todoItems });
  };

  const refreshCategoryConflict = (error: unknown) => {
    if (isApiRequestError(error) && error.status === 409) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.todoCategories });
    }
  };

  const createItem = useMutation({
    mutationKey: createTodoItemMutationKey,
    mutationFn: async (payload: CreateTodoItemRequest) => postTodoItem(payload),
    onSuccess: async (response) => {
      setStatus("ToDoを追加しました");
      await queryClient.cancelQueries({ queryKey: queryKeys.todoItems });
      const createdItem = response.data;
      queryClient.setQueryData<TodoItem[]>(queryKeys.todoItems, (current) => [
        createdItem,
        ...(current ?? []).filter((item) => item.id !== createdItem.id),
      ]);
    },
    onError: (error) => {
      refreshCategoryConflict(error);
      setStatus(`ToDoの追加に失敗しました: ${formatError(error)}`);
    },
  });

  const updateItem = useMutation({
    mutationKey: updateMutationKey,
    onMutate: () => queryClient.cancelQueries({ queryKey: queryKeys.todoItems }),
    mutationFn: async ({ itemId, payload }: TodoUpdate) => patchTodoItem(itemId, payload),
    onSuccess: async ({ data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todoItems });
      queryClient.setQueryData<TodoItem[]>(queryKeys.todoItems, (items) =>
        items?.map((item) => (item.id === data.id ? data : item)),
      );
      setStatus("ToDoを更新しました");
    },
    onError: (error) => {
      refreshCategoryConflict(error);
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
      setStatus("ToDoを完了しました");
    },
    onError: (error) => {
      setStatus(`ToDoの完了に失敗しました: ${formatError(error)}`);
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: removeMutationKey }) === 1) void invalidate();
    },
  });

  const reorderItems = useMutation({
    mutationKey: reorderMutationKey,
    onMutate: () => queryClient.cancelQueries({ queryKey: queryKeys.todoItems }),
    mutationFn: async (payload: ReorderTodoItemsRequest) => {
      const response = await postTodoItemsReorder(payload);
      return response.data.items;
    },
    onSuccess: async (items, payload) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todoItems });
      queryClient.setQueryData<TodoItem[]>(queryKeys.todoItems, (current) => {
        if (!current) return items;
        const byId = new Map(current.map((item) => [item.id, item]));
        const ids = new Set(items.map((item) => item.id));
        const requested = new Set(payload.itemIds);
        // 応答待ち中の別の編集・追加・完了を古い一覧DTOで上書きしない。
        return [
          ...current.filter((item) => !ids.has(item.id)),
          ...items.flatMap((item) => {
            const saved = byId.get(item.id);
            return saved
              ? [{ ...saved, sortKey: item.sortKey }]
              : requested.has(item.id)
                ? []
                : [item];
          }),
        ];
      });
      setStatus("並び順を更新しました");
    },
    onError: (error) => {
      void invalidate();
      setStatus(`並び順の更新に失敗しました: ${formatError(error)}`);
    },
  });

  return {
    createItem,
    updateItem,
    removeItem,
    reorderItems: { ...reorderItems, isPending: isReordering },
  };
}
