import { TodoCategoryQueryStatus } from "./TodoCategoryQueryStatus";
import { useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useTodoCategoryMutations, useTodoCategoriesQuery } from "../hooks/useTodoCategories";
import { restrictToVerticalAxis } from "../../../shared/utils/sortableAnimation";
import { SortableTodoCategory, todoCategoryDragId } from "./SortableTodoCategory";

export function TodoCategoryManager({ setStatus }: { setStatus: (message: string) => void }) {
  const query = useTodoCategoriesQuery();
  const { createCategory, removeCategory, reorderCategories } = useTodoCategoryMutations(setStatus);
  const [name, setName] = useState("");
  const pending =
    createCategory.isPending || removeCategory.isPending || reorderCategories.isPending;
  const categories = reorderCategories.isPending ? reorderCategories.variables : (query.data ?? []);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (pending || over === null || active.id === over.id) return;
    const from = categories.findIndex((category) => todoCategoryDragId(category) === active.id);
    const to = categories.findIndex((category) => todoCategoryDragId(category) === over.id);
    if (from !== -1 && to !== -1) reorderCategories.mutate(arrayMove(categories, from, to));
  };
  return (
    <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4 md:p-6">
      <p className="mt-3 text-xs text-stone-600">
        0件でもカテゴリーは残ります。カテゴリーを削除してもToDoは残り、未分類になります。
      </p>
      <p className="mt-2 text-xs text-stone-600">
        左のハンドルをドラッグすると、未分類も含めて表示順を変更できます。スマホでは長押しして動かします。
      </p>
      <div className="mt-2">
        <TodoCategoryQueryStatus query={query} />
      </div>
      <form
        className="mt-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim() || pending) return;
          try {
            await createCategory.mutateAsync(name.trim());
            setName("");
          } catch {
            /* Keep the input so it can be retried. */
          }
        }}
      >
        <fieldset disabled={pending} className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 flex-1 gap-1 text-xs text-stone-700">
            新しいカテゴリー
            <input
              className="h-10 min-w-0 rounded-lg border border-stone-300 px-3 text-sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={50}
              placeholder="例: 買い物リスト、やることリスト"
            />
          </label>
          <button
            type="submit"
            disabled={!name.trim() || pending}
            className="min-h-10 rounded-lg bg-stone-900 px-3 text-sm text-white disabled:opacity-50"
          >
            {createCategory.isPending ? "追加中…" : "カテゴリーを追加"}
          </button>
        </fieldset>
      </form>
      {createCategory.isError || removeCategory.isError || reorderCategories.isError ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          保存に失敗しました。もう一度お試しください。
        </p>
      ) : null}
      {reorderCategories.isPending ? (
        <p role="status" className="mt-2 text-xs text-stone-500">
          並び順を保存中…
        </p>
      ) : null}
      <DndContext
        sensors={sensors}
        modifiers={[restrictToVerticalAxis]}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={categories.map(todoCategoryDragId)}
          strategy={verticalListSortingStrategy}
        >
          <ul aria-label="カテゴリーの表示順" className="mt-3 grid gap-2">
            {categories.map((category) => (
              <SortableTodoCategory
                key={todoCategoryDragId(category)}
                category={category}
                disabled={pending}
                onRemove={(name) => removeCategory.mutate(name)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {query.isSuccess && query.data.length === 1 ? (
        <p className="mt-2 text-xs text-stone-500">カテゴリーはまだありません。</p>
      ) : null}
    </div>
  );
}
