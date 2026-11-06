import type { TodoItem } from "../../../lib/api/operations";
import { reorderItems } from "../../../shared/utils/reorderItems";

export function restoreTodoOrder(items: Pick<TodoItem, "id">[], reorderedVisibleIds: string[]) {
  return reorderItems(items, reorderedVisibleIds).map((item) => item.id);
}
