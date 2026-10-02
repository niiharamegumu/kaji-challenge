import { queryOptions } from "@tanstack/react-query";
import { listTodoCategories, listTodoItems } from "../../lib/api/operations";
import { queryKeys } from "./queryKeys";

export const todoItemsQueryOptions = queryOptions({
  queryKey: queryKeys.todoItems,
  queryFn: async ({ signal }) => (await listTodoItems({ signal })).data.items,
});

export const todoCategoriesQueryOptions = queryOptions({
  queryKey: queryKeys.todoCategories,
  queryFn: async ({ signal }) => (await listTodoCategories({ signal })).data.categories,
});
