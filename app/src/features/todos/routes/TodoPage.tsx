import { useSetAtom } from "jotai";
import { Plus } from "lucide-react";
import { useState } from "react";

import type { CreateTodoItemRequest, UpdateTodoItemRequest } from "../../../lib/api/operations";
import { FooterQuickAction } from "../../../shared/components/FooterQuickAction";
import { statusMessageAtom } from "../../../shared/state/status";
import { TodoItemForm, type TodoItemFormState, TodoManager } from "../components/TodoManager";
import { useTodoItemMutations, useTodoItemsQuery } from "../hooks/useTodoList";

import { TodoCategoryFilter, type TodoCategorySelection } from "../components/TodoCategoryFilter";
import { useTodoCategoriesQuery } from "../hooks/useTodoCategories";

const initialFormState: TodoItemFormState = {
  category: "",
  name: "",
  notes: "",
};

export function TodoPage() {
  const categoriesQuery = useTodoCategoriesQuery();
  const todoItemsQuery = useTodoItemsQuery();
  const setStatus = useSetAtom(statusMessageAtom);
  const { createItem, updateItem, removeItem, reorderItems } = useTodoItemMutations(setStatus);
  const [categoryFilter, setCategoryFilter] = useState<TodoCategorySelection>({ kind: "all" });
  const categories = categoriesQuery.data ?? [];
  const activeFilter: TodoCategorySelection =
    categoryFilter.kind === "category" &&
    categoriesQuery.isSuccess &&
    !categories.includes(categoryFilter.name)
      ? { kind: "all" }
      : categoryFilter;
  const visibleItems = todoItemsQuery.data.filter(
    (item) =>
      activeFilter.kind === "all" ||
      (activeFilter.kind === "unclassified"
        ? item.category == null
        : item.category === activeFilter.name),
  );
  const [form, setForm] = useState(initialFormState);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const handleCreate = async () => {
    const payload: CreateTodoItemRequest = {
      category: form.category.trim() || null,
      name: form.name.trim(),
      notes: form.notes.trim() === "" ? undefined : form.notes.trim(),
    };
    await createItem.mutateAsync(payload);
    setForm(initialFormState);
  };

  const handleUpdate = async (itemId: string, payload: UpdateTodoItemRequest) => {
    await updateItem.mutateAsync({ itemId, payload });
  };

  return (
    <section className="mt-2 w-full pb-1 md:mt-4">
      <TodoManager
        emptyMessage={
          activeFilter.kind === "all" ? undefined : "このカテゴリーのToDoはありません。"
        }
        filters={
          <TodoCategoryFilter
            categories={categories}
            value={activeFilter}
            onChange={setCategoryFilter}
          />
        }
        categories={categories}
        items={visibleItems}
        isUpdating={updateItem.isPending}
        isReordering={reorderItems.isPending}
        onDelete={(itemId) => {
          removeItem.mutate(itemId);
        }}
        onReorder={(itemIds) => {
          const visibleIds = new Set(itemIds);
          let nextIndex = 0;
          const fullOrder = todoItemsQuery.data.map((item) =>
            visibleIds.has(item.id) ? itemIds[nextIndex++] : item.id,
          );
          reorderItems.mutate({ itemIds: fullOrder });
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
        <TodoItemForm categories={categories} form={form} onFormChange={setForm} />
      </FooterQuickAction>
    </section>
  );
}
