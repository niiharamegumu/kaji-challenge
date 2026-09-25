import {
  useMutation,
  useMutationState,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import {
  type CreateShoppingListItemRequest,
  deleteShoppingItem,
  listShoppingItems,
  patchShoppingItem,
  postShoppingItem,
  postShoppingItemsReorder,
  type ReorderShoppingListItemsRequest,
  type ShoppingListItem,
  type UpdateShoppingListItemRequest,
} from "../../../lib/api/operations";
import { queryKeys } from "../../../shared/query/queryKeys";
import { handleTeamStatePreconditionFailure } from "../../../shared/query/teamStateRefresh";
import { formatError } from "../../../shared/utils/errors";

type StatusSetter = (message: string) => void;
const removeMutationKey = ["shopping-remove"];

export function usePendingShoppingRemovals() {
  return useMutationState({
    filters: { mutationKey: removeMutationKey, status: "pending" },
    select: (mutation) => mutation.state.variables as string,
  });
}

export function useShoppingItemsQuery() {
  const pendingIds = usePendingShoppingRemovals();
  const query = useSuspenseQuery({
    queryKey: queryKeys.shoppingItems,
    queryFn: async ({ signal }) => (await listShoppingItems({ signal })).data.items ?? [],
  });
  return { ...query, data: query.data.filter((item) => !pendingIds.includes(item.id)) };
}

export function useShoppingItemMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.shoppingItems });
  };

  const createItem = useMutation({
    mutationFn: async (payload: CreateShoppingListItemRequest) => postShoppingItem(payload),
    onSuccess: async (response) => {
      setStatus("買い物項目を追加しました");
      await queryClient.cancelQueries({ queryKey: queryKeys.shoppingItems });
      const createdItem = response.data;
      queryClient.setQueryData<ShoppingListItem[]>(queryKeys.shoppingItems, (current) => [
        createdItem,
        ...(current ?? []).filter((item) => item.id !== createdItem.id),
      ]);
    },
    onError: async (error) => {
      if (await handleTeamStatePreconditionFailure(error, queryClient, setStatus)) {
        return;
      }
      setStatus(`買い物項目の追加に失敗しました: ${formatError(error)}`);
    },
  });

  const updateItem = useMutation({
    mutationFn: async ({
      itemId,
      payload,
    }: {
      itemId: string;
      payload: UpdateShoppingListItemRequest;
    }) => patchShoppingItem(itemId, payload),
    onSuccess: async ({ data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.shoppingItems });
      queryClient.setQueryData<ShoppingListItem[]>(queryKeys.shoppingItems, (items) =>
        items?.map((item) => (item.id === data.id ? data : item)),
      );
      setStatus("買い物項目を更新しました");
    },
    onError: async (error) => {
      if (await handleTeamStatePreconditionFailure(error, queryClient, setStatus)) {
        return;
      }
      setStatus(`買い物項目の更新に失敗しました: ${formatError(error)}`);
    },
  });

  const removeItem = useMutation({
    mutationKey: removeMutationKey,
    mutationFn: async (itemId: string) => deleteShoppingItem(itemId),
    onSuccess: async (_, itemId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.shoppingItems });
      queryClient.setQueryData<ShoppingListItem[]>(queryKeys.shoppingItems, (items) =>
        items?.filter((item) => item.id !== itemId),
      );
      setStatus("買い物項目を削除しました");
    },
    onError: async (error) => {
      if (await handleTeamStatePreconditionFailure(error, queryClient, setStatus)) {
        return;
      }
      setStatus(`買い物項目の削除に失敗しました: ${formatError(error)}`);
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: removeMutationKey }) === 1) void invalidate();
    },
  });

  const reorderItems = useMutation({
    mutationFn: async (payload: ReorderShoppingListItemsRequest) => {
      const response = await postShoppingItemsReorder(payload);
      return response.data.items ?? [];
    },
    onSuccess: (items) => {
      queryClient.setQueryData<ShoppingListItem[]>(queryKeys.shoppingItems, items);
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

  return { createItem, updateItem, removeItem, reorderItems };
}
