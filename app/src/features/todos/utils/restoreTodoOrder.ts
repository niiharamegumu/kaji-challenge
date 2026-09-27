import type { TodoItem } from "../../../lib/api/operations";

export function restoreTodoOrder(items: Pick<TodoItem, "id">[], reorderedVisibleIds: string[]) {
  const visibleIds = new Set(reorderedVisibleIds);
  let nextIndex = 0;
  return items.map((item) =>
    visibleIds.has(item.id) ? reorderedVisibleIds[nextIndex++] : item.id,
  );
}
