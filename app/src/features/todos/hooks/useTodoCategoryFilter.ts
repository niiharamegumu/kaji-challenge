import { useState } from "react";

import type { TodoItem } from "../../../lib/api/operations";
import type { TodoCategorySelection } from "../components/TodoCategoryFilter";
import type { TodoCategorySwipeDirection } from "../components/TodoCategorySwipeArea";
import { useTodoCategoriesQuery } from "./useTodoCategories";

export function useTodoCategoryFilter() {
  const query = useTodoCategoriesQuery();
  const [selection, setSelection] = useState<TodoCategorySelection>({ kind: "all" });
  if (
    selection.kind === "category" &&
    query.data !== undefined &&
    !query.data.some((category) => category?.id === selection.id)
  ) {
    setSelection({ kind: "all" });
  }

  const filterItems = (items: TodoItem[]) =>
    items.filter(
      (item) =>
        selection.kind === "all" ||
        (selection.kind === "unclassified"
          ? item.categoryId == null
          : item.categoryId === selection.id),
    );

  const switchCategory = (direction: TodoCategorySwipeDirection) => {
    if (query.data === undefined) return;
    const categoryIds = [undefined, ...query.data.map((category) => category?.id ?? null)];
    const currentId =
      selection.kind === "all"
        ? undefined
        : selection.kind === "unclassified"
          ? null
          : selection.id;
    const index = categoryIds.indexOf(currentId);
    const nextIndex = index + (direction === "next" ? 1 : -1);
    if (index < 0 || nextIndex < 0 || nextIndex >= categoryIds.length) return;
    const id = categoryIds[nextIndex];
    setSelection(
      id === undefined
        ? { kind: "all" }
        : id === null
          ? { kind: "unclassified" }
          : { kind: "category", id },
    );
  };

  return { categoriesQuery: query, selection, setSelection, filterItems, switchCategory };
}
