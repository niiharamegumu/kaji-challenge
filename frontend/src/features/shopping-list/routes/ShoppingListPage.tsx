import { useAtom } from "jotai";
import { useState } from "react";

import type {
  CreateShoppingListItemRequest,
  UpdateShoppingListItemRequest,
} from "../../../lib/api/generated/client";
import { statusMessageAtom } from "../../shell/state/status";
import { ShoppingListManager } from "../components/ShoppingListManager";
import type { ShoppingItemFormState } from "../components/ShoppingListManager";
import {
  useShoppingItemMutations,
  useShoppingItemsQuery,
} from "../hooks/useShoppingList";

const initialFormState: ShoppingItemFormState = {
  name: "",
  quantity: "",
  notes: "",
};

export function ShoppingListPage() {
  const shoppingItemsQuery = useShoppingItemsQuery();
  const [, setStatus] = useAtom(statusMessageAtom);
  const { createItem, updateItem, removeItem, reorderItems } =
    useShoppingItemMutations(setStatus);
  const [form, setForm] = useState(initialFormState);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const handleCreate = async () => {
    const payload: CreateShoppingListItemRequest = {
      name: form.name.trim(),
      quantity: form.quantity.trim() === "" ? undefined : form.quantity.trim(),
      notes: form.notes.trim() === "" ? undefined : form.notes.trim(),
    };
    await createItem.mutateAsync(payload);
    setForm(initialFormState);
  };

  const handleUpdate = async (
    itemId: string,
    payload: UpdateShoppingListItemRequest,
  ) => {
    await updateItem.mutateAsync({ itemId, payload });
  };

  const handleDelete = async (itemId: string) => {
    await removeItem.mutateAsync(itemId);
  };

  const handleReorder = async (itemIds: string[]) => {
    await reorderItems.mutateAsync({ itemIds });
  };

  return (
    <section className="mt-2 w-full pb-1 md:mt-4">
      <ShoppingListManager
        form={form}
        items={shoppingItemsQuery.data}
        isCreateOpen={isCreateOpen}
        isReordering={reorderItems.isPending}
        onCloseCreate={() => setIsCreateOpen(false)}
        onFormChange={(updater) => {
          setForm((prev) => updater(prev));
        }}
        onOpenCreate={() => setIsCreateOpen(true)}
        onCreate={handleCreate}
        onDelete={(itemId) => {
          void handleDelete(itemId);
        }}
        onReorder={(itemIds) => {
          void handleReorder(itemIds);
        }}
        onUpdate={handleUpdate}
      />
    </section>
  );
}
