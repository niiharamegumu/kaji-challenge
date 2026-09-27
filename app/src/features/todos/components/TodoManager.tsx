import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, Pencil, CircleCheck, X } from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { useId, useState } from "react";

import type { TodoItem, UpdateTodoItemRequest } from "../../../lib/api/operations";
import { ConfirmModal } from "../../../shared/components/ConfirmModal";
import { PAGE_SECTION_CHROMELESS_CLASS_NAME } from "../../../shared/styles/pageSection";
import {
  restrictToVerticalAxis,
  smoothSortableLayoutChanges,
  smoothSortableTransition,
} from "../../../shared/utils/sortableAnimation";

import { TodoCategoryInput } from "./TodoCategoryInput";

import type { TodoCategoriesQuery } from "../hooks/useTodoCategories";
import {
  emptyTodoItemForm,
  useTodoItemFormState,
  type TodoItemFormState,
} from "../hooks/useTodoItemFormState";

type Props = Pick<
  TodoItemsSectionProps,
  | "emptyMessage"
  | "filters"
  | "categoriesQuery"
  | "items"
  | "isReordering"
  | "isUpdating"
  | "onDelete"
  | "onReorder"
  | "onUpdate"
>;

type TodoItemsSectionProps = {
  filters?: ReactNode;
  categoriesQuery: TodoCategoriesQuery;
  items: TodoItem[];
  isReordering: boolean;
  isUpdating: boolean;
  onDelete: (itemId: string) => void;
  onReorder: (itemIds: string[]) => void;
  onUpdate: (itemId: string, payload: UpdateTodoItemRequest) => Promise<void>;
  title?: string;
  description?: string;
  headerContent?: ReactNode;
  showSectionChrome?: boolean;
  articleClassName?: string;
  listClassName?: string;
  emptyClassName?: string;
  emptyMessage?: string;
};

type PendingCompleteItem = {
  id: string;
  name: string;
};

const MOBILE_SORT_DELAY_MS = 220;
const MOBILE_SORT_TOLERANCE_PX = 8;

const urlPattern = /https?:\/\/[^\s]+/g;
const trailingPunctuationPattern = /[).,!?:;]+$/;

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function renderNotesWithLinks(value: string): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(urlPattern)) {
    const matchedUrl = match[0];
    const startIndex = match.index ?? 0;
    let urlText = matchedUrl;
    let trailingText = "";

    const trailingMatch = matchedUrl.match(trailingPunctuationPattern);
    if (trailingMatch != null) {
      trailingText = trailingMatch[0];
      urlText = matchedUrl.slice(0, -trailingText.length);
    }

    if (startIndex > lastIndex) {
      parts.push(value.slice(lastIndex, startIndex));
    }

    if (isHttpUrl(urlText)) {
      parts.push(
        <a
          key={`${urlText}-${startIndex}`}
          href={urlText}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm text-stone-800 underline decoration-stone-400 underline-offset-2 transition-colors hover:text-stone-950 hover:decoration-stone-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400"
        >
          {urlText}
        </a>,
      );
    } else {
      parts.push(urlText);
    }

    if (trailingText !== "") {
      parts.push(trailingText);
    }

    lastIndex = startIndex + matchedUrl.length;
  }

  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }

  return parts;
}

function SortableTodoItem({
  categoriesQuery,
  item,
  isEditing,
  isSaving,
  isReordering,
  editState,
  onStartEdit,
  onChangeEditState,
  onCancelEdit,
  onSaveEdit,
  onComplete,
}: {
  categoriesQuery: TodoCategoriesQuery;
  item: TodoItem;
  isEditing: boolean;
  isSaving: boolean;
  isReordering: boolean;
  editState: TodoItemFormState;
  onStartEdit: (item: TodoItem) => void;
  onChangeEditState: (updater: (prev: TodoItemFormState) => TodoItemFormState) => void;
  onCancelEdit: () => void;
  onSaveEdit: (itemId: string) => void;
  onComplete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: isEditing || isReordering,
    animateLayoutChanges: smoothSortableLayoutChanges,
    transition: smoothSortableTransition,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  };

  const categoryLabel =
    item.categoryId === null
      ? "未分類"
      : (categoriesQuery.data?.find((category) => category?.id === item.categoryId)?.name ??
        (categoriesQuery.isPending ? "カテゴリー取得中…" : "カテゴリー不明"));
  const canSave = editState.name.trim().length > 0 && categoriesQuery.data !== undefined;
  const dragProps = isEditing
    ? {}
    : {
        ...attributes,
        ...listeners,
        "aria-label": `${item.name} をドラッグして並び替え`,
      };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`relative rounded-xl border border-stone-200 bg-white p-2.5 shadow-sm sm:p-3 ${isDragging ? "opacity-70 select-none" : ""}`}
    >
      {isEditing ? (
        <fieldset disabled={isSaving} className="grid gap-2">
          <TodoItemForm
            categoriesQuery={categoriesQuery}
            form={editState}
            onFormChange={onChangeEditState}
          />
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              className="flex h-9 items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10"
              onClick={() => onSaveEdit(item.id)}
              disabled={!canSave || isSaving}
              aria-busy={isSaving}
            >
              <Check size={14} aria-hidden="true" />
              <span>{isSaving ? "保存中…" : "保存"}</span>
            </button>
            <button
              type="button"
              className="flex h-9 items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-700 transition-colors hover:bg-stone-100 sm:h-10"
              onClick={onCancelEdit}
            >
              <X size={14} aria-hidden="true" />
              <span>キャンセル</span>
            </button>
          </div>
        </fieldset>
      ) : (
        <div className="flex items-start gap-2 pr-8 sm:pr-10">
          <div className="min-w-0 flex-1">
            <div className="break-words font-medium text-stone-900">{item.name}</div>
            {item.notes != null && item.notes !== "" ? (
              <div className="mt-1 whitespace-pre-wrap break-words text-xs text-stone-600">
                {renderNotesWithLinks(item.notes)}
              </div>
            ) : null}
            <div className="mt-0.5 flex min-w-0">
              <span
                className="max-w-full truncate rounded bg-stone-100 px-1.5 py-0.5 text-[10px] leading-tight text-stone-600 sm:text-[11px]"
                title={categoryLabel}
              >
                {categoryLabel}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <button
                type="button"
                className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-[11px] text-stone-700 transition-colors hover:bg-stone-100 sm:h-8 sm:text-xs"
                onClick={() => onStartEdit(item)}
                aria-label="編集"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <Pencil size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-[color:var(--color-matcha-300)] bg-[color:var(--color-matcha-50)] px-2 py-1 text-[11px] text-[color:var(--color-matcha-700)] transition-colors hover:bg-[color:var(--color-matcha-100)] sm:h-8 sm:text-xs"
                onClick={onComplete}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <CircleCheck size={12} aria-hidden="true" />
                <span>完了にする</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {!isEditing ? (
        <button
          type="button"
          className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 cursor-grab touch-none select-none items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 sm:right-3"
          onPointerDown={(event) => event.stopPropagation()}
          {...dragProps}
          disabled={isReordering}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

export function TodoItemForm({
  categoriesQuery,
  form,
  onFormChange,
}: {
  categoriesQuery: TodoCategoriesQuery;
  form: TodoItemFormState;
  onFormChange: (updater: (prev: TodoItemFormState) => TodoItemFormState) => void;
}) {
  const formId = useId();
  const handleChange = (key: keyof TodoItemFormState) => (event: ChangeEvent<HTMLInputElement>) => {
    onFormChange((prev) => ({ ...prev, [key]: event.target.value }));
  };

  return (
    <div className="grid gap-2">
      <label className="text-xs text-stone-700 sm:text-sm" htmlFor={`${formId}-name`}>
        名前
      </label>
      <input
        id={`${formId}-name`}
        className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
        value={form.name}
        onChange={handleChange("name")}
        placeholder="例: 牛乳"
      />
      <label className="text-xs text-stone-700 sm:text-sm" htmlFor={`${formId}-notes`}>
        メモ
      </label>
      <input
        id={`${formId}-notes`}
        className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
        value={form.notes}
        onChange={handleChange("notes")}
        placeholder="例: 低脂肪乳"
      />
      <TodoCategoryInput
        categoriesQuery={categoriesQuery}
        value={form.categoryId}
        onChange={(category) => onFormChange((prev) => ({ ...prev, categoryId: category }))}
      />
    </div>
  );
}

export function TodoItemsSection({
  filters,
  categoriesQuery,
  items,
  isReordering,
  isUpdating,
  onDelete,
  onReorder,
  onUpdate,
  title = "現在のToDo",
  description,
  headerContent,
  showSectionChrome = true,
  articleClassName = `mt-3 rounded-xl px-0 py-3 md:mt-4 md:rounded-2xl md:p-6 ${PAGE_SECTION_CHROMELESS_CLASS_NAME}`,
  listClassName = "mt-4",
  emptyClassName = "mx-2 mt-4 rounded-xl border border-dashed border-stone-300 bg-stone-50/80 px-4 py-8 text-center text-sm text-stone-600 md:mx-0",
  emptyMessage = "ToDoはまだありません。やることを追加してください。",
}: TodoItemsSectionProps) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editState, setEditState] = useTodoItemFormState(categoriesQuery.data);
  const [pendingCompleteItem, setPendingCompleteItem] = useState<PendingCompleteItem | null>(null);
  const [optimisticItemIds, setOptimisticItemIds] = useState<string[] | null>(null);

  const itemsById = new Map(items.map((item) => [item.id, item]));
  const pendingOrder =
    isReordering && optimisticItemIds?.length === items.length
      ? optimisticItemIds.map((id) => itemsById.get(id))
      : null;
  // A category switch or deletion can change the list while an order is being saved.
  const optimisticItems = pendingOrder?.every((item): item is TodoItem => item !== undefined)
    ? pendingOrder
    : items;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: MOBILE_SORT_DELAY_MS,
        tolerance: MOBILE_SORT_TOLERANCE_PX,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const itemIds = optimisticItems.map((item) => item.id);

  const applyReorder = (activeId: string, overId: string) => {
    if (isReordering || activeId === overId) {
      return;
    }
    const oldIndex = optimisticItems.findIndex((item) => item.id === activeId);
    const newIndex = optimisticItems.findIndex((item) => item.id === overId);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }
    const nextItems = arrayMove(optimisticItems, oldIndex, newIndex);
    const nextIds = nextItems.map((item) => item.id);
    setOptimisticItemIds(nextIds);
    onReorder(nextIds);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over == null || active.id === over.id) {
      return;
    }
    applyReorder(String(active.id), String(over.id));
  };

  const startEdit = (item: TodoItem) => {
    if (isUpdating) return;
    setEditingItemId(item.id);
    setEditState({
      categoryId: item.categoryId ?? "",
      name: item.name,
      notes: item.notes ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingItemId(null);
    setEditState(emptyTodoItemForm);
  };

  const saveEdit = async (itemId: string) => {
    const payload: UpdateTodoItemRequest = {
      categoryId: editState.categoryId || null,
      name: editState.name.trim(),
      notes: editState.notes.trim() === "" ? null : editState.notes.trim(),
    };
    if (isUpdating || categoriesQuery.data === undefined) return;
    try {
      await onUpdate(itemId, payload);
      cancelEdit();
    } catch {
      // mutation側でエラーを通知する。編集内容を残して再操作できるようにする。
    }
  };

  return (
    <>
      <article className={articleClassName}>
        {showSectionChrome ? (
          <div className="flex items-center justify-between gap-3 px-2 md:px-0">
            <div>
              <h3 className="text-base font-semibold text-stone-900">{title}</h3>
              {description != null ? (
                <p className="mt-1 text-sm text-stone-600">{description}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {headerContent}
              {isReordering ? (
                <span className="text-xs text-stone-500">並び順を保存中...</span>
              ) : null}
            </div>
          </div>
        ) : isReordering ? (
          <div className="px-2 text-right text-xs text-stone-500 md:px-0">並び順を保存中...</div>
        ) : null}

        {filters}
        {optimisticItems.length === 0 ? (
          <div className={emptyClassName}>{emptyMessage}</div>
        ) : (
          <DndContext
            sensors={sensors}
            modifiers={[restrictToVerticalAxis]}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
              <ul className={`grid gap-2 ${listClassName}`}>
                {optimisticItems.map((item) => (
                  <SortableTodoItem
                    categoriesQuery={categoriesQuery}
                    key={item.id}
                    item={item}
                    isEditing={editingItemId === item.id}
                    isSaving={isUpdating}
                    isReordering={isReordering}
                    editState={editState}
                    onStartEdit={startEdit}
                    onChangeEditState={setEditState}
                    onCancelEdit={cancelEdit}
                    onSaveEdit={(itemId) => {
                      void saveEdit(itemId);
                    }}
                    onComplete={() => setPendingCompleteItem({ id: item.id, name: item.name })}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </article>

      <ConfirmModal
        isOpen={pendingCompleteItem != null}
        title="完了にしますか？"
        message={
          pendingCompleteItem == null ? "" : `「${pendingCompleteItem.name}」をToDoから削除します。`
        }
        confirmLabel="完了にする"
        onCancel={() => setPendingCompleteItem(null)}
        onConfirm={() => {
          if (pendingCompleteItem == null) {
            return;
          }
          onDelete(pendingCompleteItem.id);
          setPendingCompleteItem(null);
        }}
      />
    </>
  );
}

export function TodoManager({
  emptyMessage,
  filters,
  categoriesQuery,
  items,
  isReordering,
  isUpdating,
  onDelete,
  onReorder,
  onUpdate,
}: Props) {
  return (
    <article
      className={`animate-enter rounded-xl px-0 py-3 md:rounded-2xl md:p-6 ${PAGE_SECTION_CHROMELESS_CLASS_NAME}`}
    >
      <div className="flex items-center justify-between gap-3 px-2 md:px-0">
        <h2 className="text-lg font-semibold text-stone-900">ToDo</h2>
      </div>
      <div className="mt-4 border-t border-stone-200 pt-4">
        <TodoItemsSection
          filters={filters}
          emptyMessage={emptyMessage}
          categoriesQuery={categoriesQuery}
          items={items}
          isReordering={isReordering}
          isUpdating={isUpdating}
          onDelete={onDelete}
          onReorder={onReorder}
          onUpdate={onUpdate}
          articleClassName=""
          headerContent={
            <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs text-stone-700">
              <span className="whitespace-nowrap">{items.length}件</span>
            </span>
          }
        />
      </div>
      <p className="mt-4 px-2 text-xs text-stone-500 md:px-0">
        ToDoをチームで共有します。完了すると削除されます。
      </p>
    </article>
  );
}
