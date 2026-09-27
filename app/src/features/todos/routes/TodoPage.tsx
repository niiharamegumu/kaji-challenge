import { useSetAtom } from "jotai";
import { Plus } from "lucide-react";
import { useState } from "react";

import type { CreateTodoItemRequest, UpdateTodoItemRequest } from "../../../lib/api/operations";
import { FooterQuickAction } from "../../../shared/components/FooterQuickAction";
import { statusMessageAtom } from "../../../shared/state/status";
import { TodoItemForm, TodoManager } from "../components/TodoManager";
import { useTodoItemMutations, useTodoItemsQuery } from "../hooks/useTodoList";

import { TodoCategoryFilter } from "../components/TodoCategoryFilter";
import { useTodoCategoryFilter } from "../hooks/useTodoCategoryFilter";
import { restoreTodoOrder } from "../utils/restoreTodoOrder";

import { emptyTodoItemForm, useTodoItemFormState } from "../hooks/useTodoItemFormState";

export function TodoPage() {
  const { categoriesQuery, selection, setSelection, filterItems } = useTodoCategoryFilter();
  const todoItemsQuery = useTodoItemsQuery();
  const setStatus = useSetAtom(statusMessageAtom);
  const { createItem, updateItem, removeItem, reorderItems } = useTodoItemMutations(setStatus);
  const visibleItems = filterItems(todoItemsQuery.data);
  const [form, setForm] = useTodoItemFormState(categoriesQuery.data);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const handleCreate = async () => {
    if (categoriesQuery.data === undefined) return;
    const payload: CreateTodoItemRequest = {
      categoryId: form.categoryId || null,
      name: form.name.trim(),
      notes: form.notes.trim() === "" ? undefined : form.notes.trim(),
    };
    await createItem.mutateAsync(payload);
    setForm(emptyTodoItemForm);
  };

  const handleUpdate = async (itemId: string, payload: UpdateTodoItemRequest) => {
    await updateItem.mutateAsync({ itemId, payload });
  };

  return (
    <section className="mt-2 w-full pb-1 md:mt-4">
      <TodoManager
        emptyMessage={selection.kind === "all" ? undefined : "このカテゴリーのToDoはありません。"}
        filters={
          <TodoCategoryFilter
            categoriesQuery={categoriesQuery}
            value={selection}
            onChange={setSelection}
          />
        }
        categoriesQuery={categoriesQuery}
        items={visibleItems}
        isUpdating={updateItem.isPending}
        isReordering={reorderItems.isPending}
        onDelete={(itemId) => {
          removeItem.mutate(itemId);
        }}
        onReorder={(itemIds) => {
          reorderItems.mutate({ itemIds: restoreTodoOrder(todoItemsQuery.data, itemIds) });
        }}
        onUpdate={handleUpdate}
      />
      <FooterQuickAction
        isOpen={isCreateOpen}
        isSubmitting={createItem.isPending}
        submitFailed={createItem.isError}
        title="ToDoを追加"
        submitLabel="追加する"
        submitIcon={<Plus size={16} aria-hidden="true" />}
        submitDisabled={form.name.trim().length === 0 || categoriesQuery.data === undefined}
        onOpen={() => {
          createItem.reset();
          setForm((previous) => ({
            ...previous,
            categoryId: selection.kind === "category" ? selection.id : "",
          }));
          setIsCreateOpen(true);
        }}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={() => {
          return handleCreate().then(() => {
            setIsCreateOpen(false);
          });
        }}
      >
        <TodoItemForm categoriesQuery={categoriesQuery} form={form} onFormChange={setForm} />
      </FooterQuickAction>
    </section>
  );
}
