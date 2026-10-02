import { useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { Plus } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import type { CreateTodoItemRequest, UpdateTodoItemRequest } from "../../../lib/api/operations";
import { FooterQuickAction } from "../../../shared/components/FooterQuickAction";
import { statusMessageAtom } from "../../../shared/state/status";
import { TodoItemForm, TodoManager } from "../components/TodoManager";
import {
  createTodoItemMutationKey,
  useTodoItemMutations,
  useTodoItemsQuery,
} from "../hooks/useTodoList";

import { TodoCategoryFilter } from "../components/TodoCategoryFilter";
import { useTodoCategoryFilter } from "../hooks/useTodoCategoryFilter";
import { restoreTodoOrder } from "../utils/restoreTodoOrder";

import { emptyTodoItemForm, useTodoItemFormState } from "../hooks/useTodoItemFormState";

export function TodoPage() {
  const queryClient = useQueryClient();
  const { categoriesQuery, selection, setSelection, filterItems, switchCategory } =
    useTodoCategoryFilter();
  const todoItemsQuery = useTodoItemsQuery();
  const setStatus = useSetAtom(statusMessageAtom);
  const { createItem, updateItem, removeItem, reorderItems } = useTodoItemMutations(setStatus);
  const visibleItems = filterItems(todoItemsQuery.data);
  const [form, setForm] = useTodoItemFormState(categoriesQuery.data);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const submitDisabled = form.name.trim().length === 0 || categoriesQuery.data === undefined;

  useEffect(() => {
    if (isCreateOpen && !createItem.isPending) {
      nameInputRef.current?.focus();
    }
  }, [isCreateOpen, createItem.isPending, createItem.data]);

  const handleCreate = async (keepOpen = false) => {
    // The cache updates synchronously, before the saving UI has rendered.
    if (queryClient.isMutating({ mutationKey: createTodoItemMutationKey }) > 0 || submitDisabled)
      return;
    const payload: CreateTodoItemRequest = {
      categoryId: form.categoryId || null,
      name: form.name.trim(),
      notes: form.notes.trim() === "" ? undefined : form.notes.trim(),
    };
    await createItem.mutateAsync(payload);
    if (keepOpen) {
      setForm((previous) => ({ ...emptyTodoItemForm, categoryId: previous.categoryId }));
    } else {
      setForm(emptyTodoItemForm);
      setIsCreateOpen(false);
    }
  };

  const handleContinue = async () => {
    try {
      await handleCreate(true);
    } catch {
      // FormSheet displays the mutation error; keep the draft available for retry.
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key !== "Enter" ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      event.repeat ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    ) {
      return;
    }
    event.preventDefault();
    void handleContinue();
  };

  const handleUpdate = async (itemId: string, payload: UpdateTodoItemRequest) => {
    await updateItem.mutateAsync({ itemId, payload });
  };

  return (
    <section className="mt-2 flex w-full flex-1 flex-col pb-1 md:mt-4">
      <TodoManager
        onCategorySwipe={switchCategory}
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
        submitDisabled={submitDisabled}
        footerStart={
          <button
            type="button"
            className="inline-flex h-11 cursor-pointer items-center rounded-xl border border-stone-300 bg-white/70 px-4 text-sm font-medium text-stone-800 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-600"
            disabled={submitDisabled || createItem.isPending}
            onClick={() => {
              void handleContinue();
            }}
          >
            続けて追加
          </button>
        }
        onOpen={() => {
          createItem.reset();
          setForm((previous) => ({
            ...previous,
            categoryId: selection.kind === "category" ? selection.id : "",
          }));
          setIsCreateOpen(true);
        }}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={() => handleCreate()}
      >
        <TodoItemForm
          categoriesQuery={categoriesQuery}
          form={form}
          onFormChange={setForm}
          nameInputRef={nameInputRef}
          onInputKeyDown={handleInputKeyDown}
        />
        <p className="mt-3 text-xs leading-relaxed text-stone-600">
          「続けて追加」またはEnterで、同じカテゴリーに次のToDoを入力できます。
        </p>
        <p role="status" className="mt-2 min-h-5 break-words text-sm text-emerald-800">
          {createItem.isSuccess ? `「${createItem.data.data.name}」を追加しました` : ""}
        </p>
      </FooterQuickAction>
    </section>
  );
}
