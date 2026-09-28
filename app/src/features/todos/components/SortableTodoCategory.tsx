import type { TodoCategory } from "../../../lib/api/operations";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import {
  smoothSortableLayoutChanges,
  smoothSortableTransition,
} from "../../../shared/utils/sortableAnimation";

export const todoCategoryDragId = (category: TodoCategory | null) =>
  category === null ? "unclassified" : `category:${category.id}`;

export function SortableTodoCategory({
  category,
  disabled,
  onRemove,
  onEdit,
}: {
  category: TodoCategory | null;
  disabled: boolean;
  onRemove: (categoryId: string) => void;
  onEdit: (category: TodoCategory) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: todoCategoryDragId(category),
    disabled,
    animateLayoutChanges: smoothSortableLayoutChanges,
    transition: smoothSortableTransition,
  });
  const label = category?.name ?? "未分類";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative flex min-w-0 items-center gap-2 rounded-lg bg-stone-50 py-1 pl-3 pr-1 ${isDragging ? "z-10 opacity-70" : ""}`}
    >
      <span className="min-w-0 flex-1 break-words text-sm">{label}</span>
      {category === null ? (
        <span className="shrink-0 px-3 text-xs text-stone-500">標準</span>
      ) : (
        <>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onEdit(category)}
            aria-label={`${label} を編集`}
            className="min-h-9 shrink-0 rounded-lg border border-stone-300 px-3 text-xs text-stone-700 disabled:opacity-50"
          >
            編集
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(category.id)}
            aria-label={`${label} を削除`}
            className="min-h-9 shrink-0 rounded-lg border border-stone-300 px-3 text-xs text-stone-700 disabled:opacity-50"
          >
            削除
          </button>
        </>
      )}
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`${label} をドラッグして並び替え`}
        className="flex size-11 shrink-0 touch-none items-center justify-center rounded-lg text-stone-500 hover:bg-stone-200 focus-visible:outline-2 focus-visible:outline-stone-500 disabled:opacity-50"
      >
        <GripVertical size={18} aria-hidden="true" />
      </button>
    </li>
  );
}
