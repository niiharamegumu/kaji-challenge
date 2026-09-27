import { useState } from "react";
import type { TodoCategoryOrder } from "../../../lib/api/operations";

export type TodoItemFormState = {
  categoryId: string;
  name: string;
  notes: string;
};

export const emptyTodoItemForm: TodoItemFormState = { categoryId: "", name: "", notes: "" };

export function useTodoItemFormState(categories: TodoCategoryOrder | undefined) {
  const [form, setForm] = useState(emptyTodoItemForm);

  // Only a loaded category list can invalidate a selection; keep the other draft fields.
  if (
    categories !== undefined &&
    form.categoryId !== "" &&
    !categories.some((category) => category?.id === form.categoryId)
  ) {
    setForm({ ...form, categoryId: "" });
  }

  return [form, setForm] as const;
}
