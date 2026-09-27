import { useState } from "react";

import type { TodoItem } from "../../../lib/api/operations";
import type { TodoCategorySelection } from "../components/TodoCategoryFilter";
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

  return { categoriesQuery: query, selection, setSelection, filterItems };
}
