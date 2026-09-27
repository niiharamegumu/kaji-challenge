import { useState } from "react";

export type TodoItemFormState = {
  category: string;
  name: string;
  notes: string;
};

export const emptyTodoItemForm: TodoItemFormState = { category: "", name: "", notes: "" };

export function useTodoItemFormState(categories: string[] | undefined) {
  const [form, setForm] = useState(emptyTodoItemForm);

  // Only a loaded category list can invalidate a selection; keep the other draft fields.
  if (categories !== undefined && form.category !== "" && !categories.includes(form.category)) {
    setForm({ ...form, category: "" });
  }

  return [form, setForm] as const;
}
