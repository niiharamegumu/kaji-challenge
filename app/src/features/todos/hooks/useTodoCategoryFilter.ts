import { useContext, useState } from "react";

import type { TodoItem } from "../../../lib/api/operations";
import { RootLayoutContext } from "../../../shared/router/rootLayoutContext";
import { ALL_TODO_CATEGORIES, type TodoCategorySelection } from "../model/defaultTodoCategory";
import type { TodoCategorySwipeDirection } from "../components/TodoCategorySwipeArea";
import { useTodoCategoriesQuery } from "./useTodoCategories";
import { useTodoDefaultCategory } from "./useTodoDefaultCategory";

export function useTodoCategoryFilter() {
  const query = useTodoCategoriesQuery();
  const context = useContext(RootLayoutContext);
  const identityKey =
    context?.currentUserId && context.currentTeamId
      ? `${context.currentUserId}:${context.currentTeamId}`
      : null;
  const [defaultCategory] = useTodoDefaultCategory(identityKey);
  const [current, setCurrent] = useState<{
    identityKey: string | null;
    selection: TodoCategorySelection | null;
  }>({ identityKey, selection: null });
  const chosen = current.identityKey === identityKey ? current.selection : null;
  const selection = chosen ?? defaultCategory ?? ALL_TODO_CATEGORIES;
  const setSelection = (value: TodoCategorySelection) =>
    setCurrent({ identityKey, selection: value });
  // Adopt the preference once per page/identity. Refetches and other tabs must not
  // override a category the user has already chosen on this page.
  if (current.identityKey !== identityKey || (chosen === null && defaultCategory !== undefined)) {
    setCurrent({ identityKey, selection: defaultCategory ?? null });
  }
  if (
    selection.kind === "category" &&
    query.data !== undefined &&
    !query.data.some((category) => category?.id === selection.id)
  ) {
    setSelection({ kind: "all" });
  }

  const filterItems = (items: TodoItem[]) =>
    selection.kind === "all"
      ? items
      : items.filter((item) =>
          selection.kind === "unclassified"
            ? item.categoryId == null
            : item.categoryId === selection.id,
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
