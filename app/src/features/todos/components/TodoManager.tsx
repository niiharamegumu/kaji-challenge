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
import type { ChangeEvent, KeyboardEventHandler, ReactNode, Ref } from "react";
import { useId, useState } from "react";

import type { TodoItem, UpdateTodoItemRequest } from "../../../lib/api/operations";
import { PAGE_SECTION_CHROMELESS_CLASS_NAME } from "../../../shared/styles/pageSection";
import {
  restrictToVerticalAxis,
  smoothSortableLayoutChanges,
  smoothSortableTransition,
} from "../../../shared/utils/sortableAnimation";

import { TodoCategoryInput } from "./TodoCategoryInput";
import { TodoCategorySwipeArea, type TodoCategorySwipeDirection } from "./TodoCategorySwipeArea";
import { useDelayedActions } from "../../../shared/state/DelayedActionProvider";
import { ActionCountdown } from "../../../shared/components/ActionCountdown";

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
  | "onCategorySwipe"
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
  onCategorySwipe?: (direction: TodoCategorySwipeDirection) => void;
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
          className="rounded-sm text-ink underline decoration-focus underline-offset-2 transition-colors hover:text-heading hover:decoration-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
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
  categoryLabel,
  item,
  isEditing,
  isSaving,
  isReordering,
  pendingCompletion,
  editState,
  onStartEdit,
  onChangeEditState,
  onCancelEdit,
  onSaveEdit,
  onComplete,
}: {
  categoriesQuery: TodoCategoriesQuery;
  categoryLabel: string;
  item: TodoItem;
  isEditing: boolean;
  isSaving: boolean;
  isReordering: boolean;
  pendingCompletion?: { deadline: number; durationMs: number };
  editState: TodoItemFormState;
  onStartEdit: (item: TodoItem) => void;
  onChangeEditState: (updater: (prev: TodoItemFormState) => TodoItemFormState) => void;
  onCancelEdit: () => void;
  onSaveEdit: (itemId: string) => void;
  onComplete: () => void;
}) {
  const isCompleting = pendingCompletion !== undefined;
  const completionLabel = isCompleting ? "取り消す" : "完了にする";
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    disabled: isEditing || isReordering || isCompleting,
    animateLayoutChanges: smoothSortableLayoutChanges,
    transition: smoothSortableTransition,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  };

  const canSave = editState.name.trim().length > 0 && categoriesQuery.data !== undefined;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`relative min-w-0 border-line bg-surface first:rounded-t-xl last:rounded-b-xl ${isDragging ? "z-10 shadow-md select-none" : ""}`}
    >
      {isEditing ? (
        <fieldset disabled={isSaving} className="grid min-w-0 gap-2 p-3">
          <TodoItemForm
            categoriesQuery={categoriesQuery}
            form={editState}
            onFormChange={onChangeEditState}
          />
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              className="flex h-9 items-center gap-1 rounded-lg border border-success-line bg-surface px-3 py-1.5 text-xs text-success transition-colors hover:bg-success-soft disabled:cursor-not-allowed disabled:opacity-50 sm:h-10"
              onClick={() => onSaveEdit(item.id)}
              disabled={!canSave || isSaving}
              aria-busy={isSaving}
            >
              <Check size={14} aria-hidden="true" />
              <span>{isSaving ? "保存中…" : "保存"}</span>
            </button>
            <button
              type="button"
              className="flex h-9 items-center gap-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs text-body transition-colors hover:bg-surface-muted sm:h-10"
              onClick={onCancelEdit}
            >
              <X size={14} aria-hidden="true" />
              <span>キャンセル</span>
            </button>
          </div>
        </fieldset>
      ) : (
        <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center py-1.5 pl-3 @min-[340px]:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="col-start-1 row-start-1 min-w-0 pr-1">
            <div className="font-medium wrap-anywhere text-heading">{item.name}</div>
            {item.notes != null && item.notes !== "" ? (
              <div className="mt-0.5 text-xs whitespace-pre-wrap wrap-anywhere text-secondary">
                {renderNotesWithLinks(item.notes)}
              </div>
            ) : null}
            {isCompleting ? <span className="text-xs text-secondary">完了待ち</span> : null}
          </div>
          <span
            className="col-start-1 row-start-2 max-w-full justify-self-start truncate rounded bg-surface-muted px-1 py-0.5 text-[11px] leading-tight text-secondary @min-[340px]:col-start-2 @min-[340px]:row-start-1 @min-[340px]:max-w-20 @min-[480px]:max-w-36"
            title={categoryLabel}
          >
            {categoryLabel}
          </span>
          <div
            className={`col-start-2 row-span-2 row-start-1 grid w-24 items-center @min-[340px]:col-start-3 @min-[340px]:row-span-1 ${isCompleting ? "grid-cols-[1fr_2.75rem_1fr]" : "grid-cols-3"}`}
          >
            <button
              type="button"
              className="flex h-11 cursor-pointer items-center justify-start rounded-lg pl-2 text-secondary transition-colors hover:bg-surface-muted hover:text-heading focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
              onClick={() => onStartEdit(item)}
              disabled={isCompleting}
              aria-label="編集"
              title="編集"
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="group flex h-11 cursor-pointer items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-focus"
              onClick={onComplete}
              aria-label={completionLabel}
              title={completionLabel}
            >
              <span
                className={`inline-flex items-center justify-center rounded-md bg-matcha-50 text-matcha-700 transition-colors group-hover:bg-matcha-100 ${isCompleting ? "w-full flex-col py-0.5 text-[0.6875rem] leading-tight font-medium whitespace-nowrap" : "size-7"}`}
              >
                {pendingCompletion !== undefined ? (
                  <>
                    <ActionCountdown
                      key={pendingCompletion.deadline}
                      deadline={pendingCompletion.deadline}
                      durationMs={pendingCompletion.durationMs}
                    />
                    <span>{completionLabel}</span>
                  </>
                ) : (
                  <CircleCheck size={18} aria-hidden="true" />
                )}
              </span>
            </button>
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`${item.name} をドラッグして並び替え`}
              className="flex h-11 cursor-grab touch-none items-center justify-end rounded-lg pr-2 text-faint select-none hover:bg-surface-muted hover:text-body focus-visible:outline-2 focus-visible:outline-focus active:cursor-grabbing disabled:opacity-50"
              disabled={isReordering || isCompleting}
            >
              <GripVertical size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function TodoItemForm({
  categoriesQuery,
  form,
  onFormChange,
  nameInputRef,
  onInputKeyDown,
}: {
  categoriesQuery: TodoCategoriesQuery;
  form: TodoItemFormState;
  onFormChange: (updater: (prev: TodoItemFormState) => TodoItemFormState) => void;
  nameInputRef?: Ref<HTMLInputElement>;
  onInputKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}) {
  const formId = useId();
  const handleChange = (key: keyof TodoItemFormState) => (event: ChangeEvent<HTMLInputElement>) => {
    onFormChange((prev) => ({ ...prev, [key]: event.target.value }));
  };

  return (
    <div className="grid gap-2">
      <label className="text-xs text-body sm:text-sm" htmlFor={`${formId}-name`}>
        名前
      </label>
      <input
        id={`${formId}-name`}
        ref={nameInputRef}
        className="h-10 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm sm:h-11"
        value={form.name}
        onChange={handleChange("name")}
        onKeyDown={onInputKeyDown}
        placeholder="例: 牛乳"
      />
      <label className="text-xs text-body sm:text-sm" htmlFor={`${formId}-notes`}>
        メモ
      </label>
      <input
        id={`${formId}-notes`}
        className="h-10 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm sm:h-11"
        value={form.notes}
        onChange={handleChange("notes")}
        onKeyDown={onInputKeyDown}
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
  onCategorySwipe,
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
  emptyClassName = "mx-2 mt-4 rounded-xl border border-dashed border-line-strong bg-surface-subtle/80 px-4 py-8 text-center text-sm text-secondary md:mx-0",
  emptyMessage = "ToDoはまだありません。やることを追加してください。",
}: TodoItemsSectionProps) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editState, setEditState] = useTodoItemFormState(categoriesQuery.data);
  const { pendingActions, schedule, undo } = useDelayedActions();
  const pendingCompletions = new Map(pendingActions.map((item) => [item.id, item]));
  const categoryNames = new Map(
    (categoriesQuery.data ?? []).flatMap((category) =>
      category ? [[category.id, category.name] as const] : [],
    ),
  );
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

  const itemIds = items.map((item) => item.id);

  const applyReorder = (activeId: string, overId: string) => {
    if (isReordering || activeId === overId) {
      return;
    }
    const oldIndex = items.findIndex((item) => item.id === activeId);
    const newIndex = items.findIndex((item) => item.id === overId);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }
    const nextItems = arrayMove(items, oldIndex, newIndex);
    const nextIds = nextItems.map((item) => item.id);
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
              <h3 className="text-base font-semibold text-heading">{title}</h3>
              {description != null ? (
                <p className="mt-1 text-sm text-secondary">{description}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {headerContent}
              {isReordering ? <span className="text-xs text-muted">並び順を保存中...</span> : null}
            </div>
          </div>
        ) : isReordering ? (
          <div className="px-2 text-right text-xs text-muted md:px-0">並び順を保存中...</div>
        ) : null}

        {filters}
        <TodoCategorySwipeArea onSwipe={onCategorySwipe}>
          {items.length === 0 ? (
            <div className={emptyClassName}>{emptyMessage}</div>
          ) : (
            <DndContext
              sensors={sensors}
              modifiers={[restrictToVerticalAxis]}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                <ul
                  className={`@container divide-y divide-line rounded-xl border border-line bg-surface ${listClassName}`}
                >
                  {items.map((item) => (
                    <SortableTodoItem
                      categoriesQuery={categoriesQuery}
                      categoryLabel={
                        item.categoryId === null
                          ? "未分類"
                          : (categoryNames.get(item.categoryId) ??
                            (categoriesQuery.isPending ? "カテゴリー取得中…" : "カテゴリー不明"))
                      }
                      key={item.id}
                      item={item}
                      isEditing={editingItemId === item.id}
                      isSaving={isUpdating}
                      isReordering={isReordering}
                      pendingCompletion={pendingCompletions.get(`todo:${item.id}`)}
                      editState={editingItemId === item.id ? editState : emptyTodoItemForm}
                      onStartEdit={startEdit}
                      onChangeEditState={setEditState}
                      onCancelEdit={cancelEdit}
                      onSaveEdit={(itemId) => {
                        void saveEdit(itemId);
                      }}
                      onComplete={() => {
                        const actionId = `todo:${item.id}`;
                        if (pendingCompletions.has(actionId)) undo(actionId);
                        else schedule(actionId, () => onDelete(item.id));
                      }}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </TodoCategorySwipeArea>
      </article>
    </>
  );
}

export function TodoManager({
  emptyMessage,
  filters,
  onCategorySwipe,
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
      className={`animate-enter flex flex-1 flex-col rounded-xl px-0 py-3 md:rounded-2xl md:p-6 ${PAGE_SECTION_CHROMELESS_CLASS_NAME}`}
    >
      <div className="flex items-center justify-between gap-3 px-2 md:px-0">
        <h2 className="text-lg font-semibold text-heading">ToDo</h2>
      </div>
      <div className="mt-4 flex flex-1 flex-col border-t border-line pt-4">
        <TodoItemsSection
          filters={filters}
          onCategorySwipe={onCategorySwipe}
          emptyMessage={emptyMessage}
          categoriesQuery={categoriesQuery}
          items={items}
          isReordering={isReordering}
          isUpdating={isUpdating}
          onDelete={onDelete}
          onReorder={onReorder}
          onUpdate={onUpdate}
          articleClassName="flex flex-1 flex-col"
          headerContent={
            <span className="rounded-full border border-line bg-surface-subtle px-3 py-1 text-xs text-body">
              <span className="whitespace-nowrap">{items.length}件</span>
            </span>
          }
        />
      </div>
      <p className="mt-4 px-2 text-xs text-muted md:px-0">
        ToDoをチームで共有します。完了すると削除されます。
      </p>
    </article>
  );
}
