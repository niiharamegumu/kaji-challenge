import { useUserPreferences } from "../../../shared/state/userPreferences";
import type { TodoCategorySelection } from "../../../contracts/user-preferences";

export function useTodoDefaultCategory() {
  const { preferences, ready, update } = useUserPreferences();
  return [
    ready ? preferences.defaultTodoCategory : undefined,
    (selection: TodoCategorySelection) => update({ defaultTodoCategory: selection }),
  ] as const;
}
