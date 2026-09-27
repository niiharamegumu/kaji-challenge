import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type TodoItem,
  type TodoCategoryOrder,
  deleteTodoCategory,
  listTodoCategories,
  postTodoCategory,
  postTodoCategoriesReorder,
} from "../../../lib/api/operations";
import { queryKeys } from "../../../shared/query/queryKeys";
import { formatError } from "../../../shared/utils/errors";

export function useTodoCategoriesQuery() {
  return useQuery({
    queryKey: queryKeys.todoCategories,
    queryFn: async ({ signal }) => (await listTodoCategories({ signal })).data.categories,
  });
}

export type TodoCategoriesQuery = Pick<
  ReturnType<typeof useTodoCategoriesQuery>,
  "data" | "isPending" | "isError" | "refetch"
>;

export function useTodoCategoryMutations(setStatus: (message: string) => void) {
  const client = useQueryClient();
  const createCategory = useMutation({
    mutationFn: (name: string) => postTodoCategory({ name }),
    onSuccess: async ({ data }) => {
      await client.cancelQueries({ queryKey: queryKeys.todoCategories });
      client.setQueryData(queryKeys.todoCategories, data.categories);
      setStatus("カテゴリーを追加しました");
    },
    onError: (error) => setStatus(`カテゴリーの追加に失敗しました: ${formatError(error)}`),
  });
  const removeCategory = useMutation({
    mutationFn: (name: string) => deleteTodoCategory(name),
    onSuccess: async (_, name) => {
      await Promise.all([
        client.cancelQueries({ queryKey: queryKeys.todoCategories }),
        client.cancelQueries({ queryKey: queryKeys.todoItems }),
      ]);
      client.setQueryData<TodoCategoryOrder>(queryKeys.todoCategories, (categories) =>
        categories?.filter((category) => category !== name),
      );
      client.setQueryData<TodoItem[]>(queryKeys.todoItems, (items) =>
        items?.map((item) => (item.category === name ? { ...item, category: null } : item)),
      );
      void Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.todoCategories }),
        client.invalidateQueries({ queryKey: queryKeys.todoItems }),
      ]);
      setStatus("カテゴリーを削除しました。紐付いていたToDoは未分類になります");
    },
    onError: (error) => setStatus(`カテゴリーの削除に失敗しました: ${formatError(error)}`),
  });
  const reorderCategories = useMutation({
    mutationFn: (categories: TodoCategoryOrder) => postTodoCategoriesReorder({ categories }),
    onSuccess: async ({ data }) => {
      await client.cancelQueries({ queryKey: queryKeys.todoCategories });
      client.setQueryData(queryKeys.todoCategories, data.categories);
      setStatus("カテゴリーの並び順を保存しました");
    },
    onError: (error) => {
      setStatus(`カテゴリーの並べ替えに失敗しました: ${formatError(error)}`);
      void client.invalidateQueries({ queryKey: queryKeys.todoCategories });
    },
  });
  return { createCategory, removeCategory, reorderCategories };
}
