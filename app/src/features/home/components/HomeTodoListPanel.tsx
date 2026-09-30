import { ListTodo } from "lucide-react";
import { Link } from "../../../shared/router/navigation";

import type { TodoItem, UpdateTodoItemRequest } from "../../../lib/api/operations";
import {
  restoreTodoOrder,
  TodoCategoryFilter,
  TodoItemsSection,
  useTodoCategoryFilter,
} from "../../todos";
import { HOME_PANEL_CLASS_NAME } from "./panelStyles";

type Props = {
  items: TodoItem[];
  isReordering: boolean;
  isUpdating: boolean;
  onDelete: (itemId: string) => void;
  onReorder: (itemIds: string[]) => void;
  onUpdate: (itemId: string, payload: UpdateTodoItemRequest) => Promise<void>;
};

export function HomeTodoListPanel({
  items,
  isReordering,
  isUpdating,
  onDelete,
  onReorder,
  onUpdate,
}: Props) {
  const { categoriesQuery, selection, setSelection, filterItems, switchCategory } =
    useTodoCategoryFilter();
  return (
    <article className={`min-w-0 ${HOME_PANEL_CLASS_NAME}`}>
      <div className="flex items-center justify-between gap-2 px-2 md:px-0">
        <h2 className="text-lg font-semibold">ToDo</h2>
        <Link
          to="/todos"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-stone-300 bg-white px-2.5 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 hover:text-stone-900"
        >
          <ListTodo size={16} aria-hidden="true" />
          <span>ToDoへ</span>
        </Link>
      </div>
      <TodoCategoryFilter
        categoriesQuery={categoriesQuery}
        value={selection}
        onChange={setSelection}
      />
      <TodoItemsSection
        onCategorySwipe={switchCategory}
        categoriesQuery={categoriesQuery}
        items={filterItems(items)}
        isReordering={isReordering}
        isUpdating={isUpdating}
        onDelete={onDelete}
        onReorder={(itemIds) => onReorder(restoreTodoOrder(items, itemIds))}
        onUpdate={onUpdate}
        showSectionChrome={false}
        articleClassName="mt-2"
        listClassName=""
        emptyMessage={
          selection.kind === "all"
            ? "ToDoはまだありません。やることを追加してください。"
            : "このカテゴリーのToDoはありません。"
        }
        emptyClassName="mx-2 rounded-xl border border-dashed border-stone-300 bg-stone-50/80 px-4 py-8 text-center text-sm text-stone-600 md:mx-0"
      />
    </article>
  );
}
