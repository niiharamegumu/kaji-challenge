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
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Pencil,
  Plus,
  ShoppingBasket,
  X,
} from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { startTransition, useOptimistic, useState } from "react";

import type {
  ShoppingListItem,
  UpdateShoppingListItemRequest,
} from "../../../lib/api/generated/client";
import { ConfirmModal } from "../../admin/components/ConfirmModal";

type ShoppingItemFormState = {
  name: string;
  quantity: string;
  notes: string;
};

type Props = {
  form: ShoppingItemFormState;
  items: ShoppingListItem[];
  isReordering: boolean;
  onFormChange: (
    updater: (prev: ShoppingItemFormState) => ShoppingItemFormState,
  ) => void;
  onCreate: () => void;
  onDelete: (itemId: string) => void;
  onReorder: (itemIds: string[]) => void;
  onUpdate: (
    itemId: string,
    payload: UpdateShoppingListItemRequest,
  ) => Promise<void>;
};

type EditState = {
  name: string;
  quantity: string;
  notes: string;
};

type PendingCompleteItem = {
  id: string;
  name: string;
};

const jstDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "short",
  day: "numeric",
});

function formatCreatedAt(value: string) {
  return jstDateFormatter.format(new Date(value));
}

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
          className="underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900"
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
  isFirst,
  isLast,
  isEditing,
  editState,
  onStartEdit,
  onChangeEditState,
  onCancelEdit,
  onSaveEdit,
  onMoveUp,
  onMoveDown,
  onComplete,
}: {
  item: ShoppingListItem;
  isFirst: boolean;
  isLast: boolean;
  isEditing: boolean;
  editState: EditState;
  onStartEdit: (item: ShoppingListItem) => void;
  onChangeEditState: (next: EditState) => void;
  onCancelEdit: () => void;
  onSaveEdit: (itemId: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onComplete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
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
      className={`relative rounded-xl border border-stone-200 bg-white p-3 shadow-sm ${
        isEditing ? "cursor-default" : "cursor-pointer"
      } ${isDragging ? "opacity-70" : ""}`}
      {...dragProps}
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
            htmlFor={`shopping-quantity-${item.id}`}
          >
            数量
          </label>
          <input
            id={`shopping-quantity-${item.id}`}
            className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
            value={editState.quantity}
            onChange={(event) =>
              onChangeEditState({ ...editState, quantity: event.target.value })
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
          <div className="flex items-start gap-3 pr-8">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="font-medium text-stone-900">{item.name}</div>
                {item.quantity != null && item.quantity !== "" ? (
                  <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs text-stone-700">
                    {item.quantity}
                  </span>
                ) : null}
              </div>
              {item.notes != null && item.notes !== "" ? (
                <div className="mt-1 whitespace-pre-wrap break-words text-xs text-stone-600">
                  {renderNotesWithLinks(item.notes)}
                </div>
              ) : null}
              <div className="mt-2 text-[11px] text-stone-500">
                追加日 {formatCreatedAt(item.createdAt)}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="flex h-9 cursor-pointer items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-700 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onMoveUp}
              disabled={isFirst}
              aria-label={`${item.name} を上に移動`}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <ArrowUp size={14} aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">上へ</span>
            </button>
            <button
              type="button"
              className="flex h-9 cursor-pointer items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-700 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onMoveDown}
              disabled={isLast}
              aria-label={`${item.name} を下に移動`}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <ArrowDown size={14} aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">下へ</span>
            </button>
            <button
              type="button"
              className="flex h-9 cursor-pointer items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-700 transition-colors hover:bg-stone-100"
              onClick={() => onStartEdit(item)}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Pencil size={14} aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">編集</span>
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
        </>
      )}
      {!isEditing ? (
        <div
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-stone-400"
          aria-hidden="true"
        >
          <GripVertical size={16} aria-hidden="true" />
        </div>
      ) : null}
    </li>
  );
}

export function ShoppingListManager({
  form,
  items,
  isReordering,
  onFormChange,
  onCreate,
  onDelete,
  onReorder,
  onUpdate,
}: Props) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({
    name: "",
    quantity: "",
    notes: "",
  });
  const [pendingCompleteItem, setPendingCompleteItem] =
    useState<PendingCompleteItem | null>(null);
  const [optimisticItems, setOptimisticItems] = useOptimistic(
    items,
    (_currentItems, nextItems: ShoppingListItem[]) => nextItems,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const itemIds = optimisticItems.map((item) => item.id);

  const handleChange =
    (key: keyof ShoppingItemFormState) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onFormChange((prev) => ({ ...prev, [key]: event.target.value }));
    };

  const canCreate = form.name.trim().length > 0;

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
      setOptimisticItems(nextItems);
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

  const moveItem = (index: number, delta: number) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= optimisticItems.length) {
      return;
    }
    const nextItems = arrayMove(optimisticItems, index, nextIndex);
    startTransition(() => {
      setOptimisticItems(nextItems);
    });
    onReorder(nextItems.map((item) => item.id));
  };

  const startEdit = (item: ShoppingListItem) => {
    setEditingItemId(item.id);
    setEditState({
      name: item.name,
      quantity: item.quantity ?? "",
      notes: item.notes ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingItemId(null);
    setEditState({ name: "", quantity: "", notes: "" });
  };

  const saveEdit = async (itemId: string) => {
    const payload: UpdateShoppingListItemRequest = {
      name: editState.name.trim(),
      quantity:
        editState.quantity.trim() === "" ? null : editState.quantity.trim(),
      notes: editState.notes.trim() === "" ? null : editState.notes.trim(),
    };
    await onUpdate(itemId, payload);
    cancelEdit();
  };

  return (
    <>
      <article className="animate-enter rounded-xl border border-stone-200 bg-white/90 p-3 shadow-sm md:rounded-2xl md:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-stone-900">
              買い物リスト
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              今必要なものだけをチームで共有します。購入済みにすると一覧から消えます。
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2">
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
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label
                className="text-xs text-stone-700 sm:text-sm"
                htmlFor="shopping-item-quantity"
              >
                数量
              </label>
              <input
                id="shopping-item-quantity"
                className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
                value={form.quantity}
                onChange={handleChange("quantity")}
                placeholder="例: 2本"
              />
            </div>
            <div className="grid gap-1.5">
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
          </div>
          <div className="mt-1 flex justify-start">
            <button
              type="button"
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-3 py-2 text-sm text-white transition-colors duration-200 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50 sm:h-11 sm:w-auto sm:min-w-40"
              onClick={onCreate}
              disabled={!canCreate}
            >
              <Plus size={16} aria-hidden="true" />
              <span>追加する</span>
            </button>
          </div>
        </div>
      </article>

      <article className="mt-3 rounded-xl border border-stone-200 bg-white/90 p-3 shadow-sm md:mt-4 md:rounded-2xl md:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-stone-900">
              現在の買い物
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs text-stone-700">
              <span className="whitespace-nowrap">
                {optimisticItems.length}件
              </span>
            </span>
            {isReordering ? (
              <span className="text-xs text-stone-500">並び順を保存中...</span>
            ) : null}
          </div>
        </div>

        {optimisticItems.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-stone-300 bg-stone-50/80 px-4 py-8 text-center text-sm text-stone-600">
            買い物項目はまだありません。必要なものを追加してください。
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={itemIds}
              strategy={verticalListSortingStrategy}
            >
              <ul className="mt-4 grid gap-2">
                {optimisticItems.map((item, index) => (
                  <SortableShoppingItem
                    key={item.id}
                    item={item}
                    isFirst={index === 0}
                    isLast={index === optimisticItems.length - 1}
                    isEditing={editingItemId === item.id}
                    editState={editState}
                    onStartEdit={startEdit}
                    onChangeEditState={setEditState}
                    onCancelEdit={cancelEdit}
                    onSaveEdit={(itemId) => {
                      void saveEdit(itemId);
                    }}
                    onMoveUp={() => moveItem(index, -1)}
                    onMoveDown={() => moveItem(index, 1)}
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
