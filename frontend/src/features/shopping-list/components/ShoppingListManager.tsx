import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  GripVertical,
  Pencil,
  Plus,
  ShoppingBasket,
  X,
} from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { startTransition, useState } from "react";

import type {
  ShoppingListItem,
  UpdateShoppingListItemRequest,
} from "../../../lib/api/generated/client";
import { ConfirmModal } from "../../../shared/components/ConfirmModal";
import { FormSheet } from "../../../shared/components/FormSheet";
import { PAGE_SECTION_CHROMELESS_CLASS_NAME } from "../../../shared/styles/pageSection";
import {
  restrictToVerticalAxis,
  smoothSortableLayoutChanges,
  smoothSortableTransition,
} from "../../../shared/utils/sortableAnimation";

export type ShoppingItemFormState = {
  name: string;
  notes: string;
};

type Props = {
  form: ShoppingItemFormState;
  items: ShoppingListItem[];
  isCreateOpen: boolean;
  isReordering: boolean;
  showCreateButton?: boolean;
  onCloseCreate: () => void;
  onFormChange: (
    updater: (prev: ShoppingItemFormState) => ShoppingItemFormState,
  ) => void;
  onOpenCreate: () => void;
  onCreate: () => Promise<void>;
  onDelete: (itemId: string) => void;
  onReorder: (itemIds: string[]) => void;
  onUpdate: (
    itemId: string,
    payload: UpdateShoppingListItemRequest,
  ) => Promise<void>;
};

type ShoppingListItemsSectionProps = {
  items: ShoppingListItem[];
  isReordering: boolean;
  onDelete: (itemId: string) => void;
  onReorder: (itemIds: string[]) => void;
  onUpdate: (
    itemId: string,
    payload: UpdateShoppingListItemRequest,
  ) => Promise<void>;
  title?: string;
  description?: string;
  headerContent?: ReactNode;
  showSectionChrome?: boolean;
  articleClassName?: string;
  listClassName?: string;
  emptyClassName?: string;
  emptyMessage?: string;
};

type EditState = {
  name: string;
  notes: string;
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

function SortableShoppingItem({
  item,
  isEditing,
  editState,
  onStartEdit,
  onChangeEditState,
  onCancelEdit,
  onSaveEdit,
  onComplete,
}: {
  item: ShoppingListItem;
  isEditing: boolean;
  editState: EditState;
  onStartEdit: (item: ShoppingListItem) => void;
  onChangeEditState: (next: EditState) => void;
  onCancelEdit: () => void;
  onSaveEdit: (itemId: string) => void;
  onComplete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    animateLayoutChanges: smoothSortableLayoutChanges,
    transition: smoothSortableTransition,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  };

  const canSave = editState.name.trim().length > 0;
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
      className={`relative rounded-xl border border-stone-200 bg-white p-3 shadow-sm ${isDragging ? "opacity-70 select-none" : ""}`}
    >
      {isEditing ? (
        <div className="grid gap-2">
          <label
            className="text-xs text-stone-700"
            htmlFor={`shopping-name-${item.id}`}
          >
            名前
          </label>
          <input
            id={`shopping-name-${item.id}`}
            className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
            value={editState.name}
            onChange={(event) =>
              onChangeEditState({ ...editState, name: event.target.value })
            }
          />
          <label
            className="text-xs text-stone-700"
            htmlFor={`shopping-notes-${item.id}`}
          >
            メモ
          </label>
          <input
            id={`shopping-notes-${item.id}`}
            className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
            value={editState.notes}
            onChange={(event) =>
              onChangeEditState({ ...editState, notes: event.target.value })
            }
          />
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              className="flex h-9 items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10"
              onClick={() => onSaveEdit(item.id)}
              disabled={!canSave}
            >
              <Check size={14} aria-hidden="true" />
              <span>保存</span>
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
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3 pr-10">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-stone-900">{item.name}</div>
              {item.notes != null && item.notes !== "" ? (
                <div className="mt-1 whitespace-pre-wrap break-words text-xs text-stone-600">
                  {renderNotesWithLinks(item.notes)}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="flex h-9 cursor-pointer items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-700 transition-colors hover:bg-stone-100"
                    onClick={() => onStartEdit(item)}
                    aria-label="編集"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="flex h-9 cursor-pointer items-center gap-1 rounded-lg border border-[color:var(--color-matcha-300)] bg-[color:var(--color-matcha-50)] px-2.5 py-1.5 text-xs text-[color:var(--color-matcha-700)] transition-colors hover:bg-[color:var(--color-matcha-100)]"
                    onClick={onComplete}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <ShoppingBasket size={14} aria-hidden="true" />
                    <span>購入済みにする</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      {!isEditing ? (
        <button
          type="button"
          className="absolute top-1/2 right-3 flex h-8 w-8 -translate-y-1/2 cursor-grab touch-none select-none items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400"
          onPointerDown={(event) => event.stopPropagation()}
          {...dragProps}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

export function ShoppingItemForm({
  form,
  onFormChange,
}: {
  form: ShoppingItemFormState;
  onFormChange: (
    updater: (prev: ShoppingItemFormState) => ShoppingItemFormState,
  ) => void;
}) {
  const handleChange =
    (key: keyof ShoppingItemFormState) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onFormChange((prev) => ({ ...prev, [key]: event.target.value }));
    };

  return (
    <div className="grid gap-2">
      <label
        className="text-xs text-stone-700 sm:text-sm"
        htmlFor="shopping-item-name"
      >
        名前
      </label>
      <input
        id="shopping-item-name"
        className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
        value={form.name}
        onChange={handleChange("name")}
        placeholder="例: 牛乳"
      />
      <label
        className="text-xs text-stone-700 sm:text-sm"
        htmlFor="shopping-item-notes"
      >
        メモ
      </label>
      <input
        id="shopping-item-notes"
        className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
        value={form.notes}
        onChange={handleChange("notes")}
        placeholder="例: 低脂肪乳"
      />
    </div>
  );
}

export function ShoppingListItemsSection({
  items,
  isReordering,
  onDelete,
  onReorder,
  onUpdate,
  title = "現在の買い物",
  description,
  headerContent,
  showSectionChrome = true,
  articleClassName = `mt-3 rounded-xl px-0 py-3 md:mt-4 md:rounded-2xl md:p-6 ${PAGE_SECTION_CHROMELESS_CLASS_NAME}`,
  listClassName = "mt-4",
  emptyClassName = "mx-2 mt-4 rounded-xl border border-dashed border-stone-300 bg-stone-50/80 px-4 py-8 text-center text-sm text-stone-600 md:mx-0",
  emptyMessage = "買い物項目はまだありません。必要なものを追加してください。",
}: ShoppingListItemsSectionProps) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({
    name: "",
    notes: "",
  });
  const [pendingCompleteItem, setPendingCompleteItem] =
    useState<PendingCompleteItem | null>(null);
  const [optimisticItemIds, setOptimisticItemIds] = useState<string[] | null>(
    null,
  );

  const serverItemIds = items.map((item) => item.id);
  const shouldUseOptimisticOrder =
    optimisticItemIds != null &&
    optimisticItemIds.length === serverItemIds.length &&
    optimisticItemIds.some((itemId, index) => itemId !== serverItemIds[index]);
  const optimisticItemIndex =
    shouldUseOptimisticOrder && optimisticItemIds != null
      ? new Map(optimisticItemIds.map((itemId, index) => [itemId, index]))
      : null;
  const optimisticItems =
    optimisticItemIndex == null
      ? items
      : [...items].sort(
          (left, right) =>
            (optimisticItemIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
            (optimisticItemIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER),
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

  const itemIds = optimisticItems.map((item) => item.id);

  const applyReorder = (activeId: string, overId: string) => {
    if (activeId === overId) {
      return;
    }
    const oldIndex = optimisticItems.findIndex((item) => item.id === activeId);
    const newIndex = optimisticItems.findIndex((item) => item.id === overId);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }
    const nextItems = arrayMove(optimisticItems, oldIndex, newIndex);
    startTransition(() => {
      setOptimisticItemIds(nextItems.map((item) => item.id));
    });
    onReorder(nextItems.map((item) => item.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over == null || active.id === over.id) {
      return;
    }
    applyReorder(String(active.id), String(over.id));
  };

  const startEdit = (item: ShoppingListItem) => {
    setEditingItemId(item.id);
    setEditState({
      name: item.name,
      notes: item.notes ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingItemId(null);
    setEditState({ name: "", notes: "" });
  };

  const saveEdit = async (itemId: string) => {
    const payload: UpdateShoppingListItemRequest = {
      name: editState.name.trim(),
      notes: editState.notes.trim() === "" ? null : editState.notes.trim(),
    };
    await onUpdate(itemId, payload);
    cancelEdit();
  };

  return (
    <>
      <article className={articleClassName}>
        {showSectionChrome ? (
          <div className="flex items-center justify-between gap-3 px-2 md:px-0">
            <div>
              <h3 className="text-base font-semibold text-stone-900">
                {title}
              </h3>
              {description != null ? (
                <p className="mt-1 text-sm text-stone-600">{description}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {headerContent}
              {isReordering ? (
                <span className="text-xs text-stone-500">
                  並び順を保存中...
                </span>
              ) : null}
            </div>
          </div>
        ) : isReordering ? (
          <div className="px-2 text-right text-xs text-stone-500 md:px-0">
            並び順を保存中...
          </div>
        ) : null}

        {optimisticItems.length === 0 ? (
          <div className={emptyClassName}>{emptyMessage}</div>
        ) : (
          <DndContext
            sensors={sensors}
            modifiers={[restrictToVerticalAxis]}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={itemIds}
              strategy={verticalListSortingStrategy}
            >
              <ul className={`grid gap-2 ${listClassName}`}>
                {optimisticItems.map((item) => (
                  <SortableShoppingItem
                    key={item.id}
                    item={item}
                    isEditing={editingItemId === item.id}
                    editState={editState}
                    onStartEdit={startEdit}
                    onChangeEditState={setEditState}
                    onCancelEdit={cancelEdit}
                    onSaveEdit={(itemId) => {
                      void saveEdit(itemId);
                    }}
                    onComplete={() =>
                      setPendingCompleteItem({ id: item.id, name: item.name })
                    }
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </article>

      <ConfirmModal
        isOpen={pendingCompleteItem != null}
        title="購入済みにしますか？"
        message={
          pendingCompleteItem == null
            ? ""
            : `「${pendingCompleteItem.name}」を買い物リストから削除します。`
        }
        confirmLabel="購入済みにする"
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

export function ShoppingListManager({
  form,
  items,
  isCreateOpen,
  isReordering,
  showCreateButton = true,
  onCloseCreate,
  onFormChange,
  onOpenCreate,
  onCreate,
  onDelete,
  onReorder,
  onUpdate,
}: Props) {
  const canCreate = form.name.trim().length > 0;

  return (
    <>
      <article
        className={`animate-enter rounded-xl px-0 py-3 md:rounded-2xl md:p-6 ${PAGE_SECTION_CHROMELESS_CLASS_NAME}`}
      >
        <div className="flex items-center justify-between gap-3 px-2 md:px-0">
          <h2 className="text-lg font-semibold text-stone-900">買い物リスト</h2>
          {showCreateButton ? (
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-stone-900 text-white transition-colors hover:bg-stone-800"
              onClick={onOpenCreate}
              aria-label="追加"
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="mt-4 border-t border-stone-200 pt-4">
          <ShoppingListItemsSection
            items={items}
            isReordering={isReordering}
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
          今必要なものだけをチームで共有します。購入済みにすると一覧から消えます。
        </p>
      </article>

      <FormSheet
        isOpen={isCreateOpen}
        title="買い物項目を追加"
        submitLabel="追加する"
        submitIcon={<Plus size={16} aria-hidden="true" />}
        submitDisabled={!canCreate}
        onClose={onCloseCreate}
        onSubmit={() => {
          void onCreate().then(onCloseCreate);
        }}
      >
        <ShoppingItemForm form={form} onFormChange={onFormChange} />
      </FormSheet>
    </>
  );
}
