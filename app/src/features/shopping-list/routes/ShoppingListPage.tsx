import { useAtom } from "jotai";
import { Plus } from "lucide-react";
import { useState } from "react";

import type {
  CreateShoppingListItemRequest,
  UpdateShoppingListItemRequest,
} from "../../../lib/api/operations";
import { FooterQuickAction } from "../../../shared/components/FooterQuickAction";
import { statusMessageAtom } from "../../../shared/state/status";
import {
  ShoppingItemForm,
  type ShoppingItemFormState,
  ShoppingListManager,
} from "../components/ShoppingListManager";
import { useShoppingItemMutations, useShoppingItemsQuery } from "../hooks/useShoppingList";

const initialFormState: ShoppingItemFormState = {
  name: "",
  notes: "",
};

export function ShoppingListPage() {
  const shoppingItemsQuery = useShoppingItemsQuery();
  const [, setStatus] = useAtom(statusMessageAtom);
  const { createItem, updateItem, removeItem, reorderItems } = useShoppingItemMutations(setStatus);
  const [form, setForm] = useState(initialFormState);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const handleCreate = async () => {
    const payload: CreateShoppingListItemRequest = {
      name: form.name.trim(),
      notes: form.notes.trim() === "" ? undefined : form.notes.trim(),
    };
    await createItem.mutateAsync(payload);
    setForm(initialFormState);
  };

  const handleUpdate = async (itemId: string, payload: UpdateShoppingListItemRequest) => {
    await updateItem.mutateAsync({ itemId, payload });
  };

  return (
    <section className="mt-2 w-full pb-1 md:mt-4">
      <ShoppingListManager
        form={form}
        items={shoppingItemsQuery.data}
        isCreateOpen={false}
        isCreating={createItem.isPending}
        createFailed={createItem.isError}
        isUpdating={updateItem.isPending}
        isReordering={reorderItems.isPending}
        showCreateButton={false}
        onCloseCreate={() => setIsCreateOpen(false)}
        onFormChange={(updater) => {
          setForm((prev) => updater(prev));
        }}
        onOpenCreate={() => {
          createItem.reset();
          setIsCreateOpen(true);
        }}
        onCreate={handleCreate}
        onDelete={(itemId) => {
          removeItem.mutate(itemId);
        }}
        onReorder={(itemIds) => {
          reorderItems.mutate({ itemIds });
        }}
        onUpdate={handleUpdate}
      />
      <FooterQuickAction
        isOpen={isCreateOpen}
        isSubmitting={createItem.isPending}
        submitFailed={createItem.isError}
        title="買い物項目を追加"
        submitLabel="追加する"
        submitIcon={<Plus size={16} aria-hidden="true" />}
        submitDisabled={form.name.trim().length === 0}
        onOpen={() => {
          createItem.reset();
          setIsCreateOpen(true);
        }}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={() => {
          return handleCreate().then(() => {
            setIsCreateOpen(false);
          });
        }}
      >
        <ShoppingItemForm
          form={form}
          onFormChange={(updater) => {
            setForm((prev) => updater(prev));
          }}
        />
      </FooterQuickAction>
    </section>
  );
}
