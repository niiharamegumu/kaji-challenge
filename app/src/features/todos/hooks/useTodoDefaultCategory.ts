import { useAtom } from "jotai";
import { useMemo } from "react";
import { createTodoDefaultCategoryAtom } from "../model/defaultTodoCategory";

export function useTodoDefaultCategory(identityKey: string | null) {
  const preference = useMemo(() => createTodoDefaultCategoryAtom(identityKey), [identityKey]);
  return useAtom(preference);
}
