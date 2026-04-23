import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import {
  type CreateShoppingListItemRequest,
  type ReorderShoppingListItemsRequest,
  type ShoppingListItem,
  type UpdateShoppingListItemRequest,
  deleteShoppingItem,
  listShoppingItems,
  patchShoppingItem,
  postShoppingItem,
  postShoppingItemsReorder,
} from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import { formatError } from "../../../shared/utils/errors";
import { handleTeamStatePreconditionFailure } from "../../shell/lib/teamStateRefresh";

type StatusSetter = (message: string) => void;

const hasShoppingItems = (
  value: unknown,
): value is { items?: ShoppingListItem[] } =>
  value != null && typeof value === "object" && "items" in value;

export function useShoppingItemsQuery() {
  return useSuspenseQuery({
    queryKey: queryKeys.shoppingItems,
    queryFn: async () => (await listShoppingItems()).data.items ?? [],
  });
}

export function useShoppingItemMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.shoppingItems });
  };

  const createItem = useMutation({
    mutationFn: async (payload: CreateShoppingListItemRequest) =>
      postShoppingItem(payload),
    onSuccess: async () => {
      setStatus("買い物項目を追加しました");
      await invalidate();
    },
    onError: async (error) => {
      if (
        await handleTeamStatePreconditionFailure(error, queryClient, setStatus)
      ) {
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
    onSuccess: async () => {
      setStatus("買い物項目を更新しました");
      await invalidate();
    },
    onError: async (error) => {
      if (
        await handleTeamStatePreconditionFailure(error, queryClient, setStatus)
      ) {
        return;
      }
      setStatus(`買い物項目の更新に失敗しました: ${formatError(error)}`);
    },
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => deleteShoppingItem(itemId),
    onSuccess: async () => {
      setStatus("買い物項目を削除しました");
      await invalidate();
    },
    onError: async (error) => {
      if (
        await handleTeamStatePreconditionFailure(error, queryClient, setStatus)
      ) {
        return;
      }
      setStatus(`買い物項目の削除に失敗しました: ${formatError(error)}`);
    },
  });

  const reorderItems = useMutation({
    mutationFn: async (payload: ReorderShoppingListItemsRequest) => {
      const response = await postShoppingItemsReorder(payload);
      if (!hasShoppingItems(response.data)) {
        throw new Error("unexpected shopping reorder response");
      }
      return response.data.items ?? [];
    },
    onSuccess: (items) => {
      queryClient.setQueryData<ShoppingListItem[]>(
        queryKeys.shoppingItems,
        items,
      );
      setStatus("並び順を更新しました");
    },
    onError: async (error) => {
      if (
        await handleTeamStatePreconditionFailure(error, queryClient, setStatus)
      ) {
        return;
      }
      void invalidate();
      setStatus(`並び順の更新に失敗しました: ${formatError(error)}`);
    },
  });

  return { createItem, updateItem, removeItem, reorderItems };
}
