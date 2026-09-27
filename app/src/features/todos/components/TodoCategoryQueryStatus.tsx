import type { TodoCategoriesQuery } from "../hooks/useTodoCategories";

export function TodoCategoryQueryStatus({ query }: { query: TodoCategoriesQuery }) {
  if (query.isPending) {
    return (
      <p role="status" className="text-xs text-stone-500">
        カテゴリーを読み込み中…
      </p>
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="text-xs text-red-700">
        カテゴリーを読み込めませんでした。
        <button type="button" className="ml-1 underline" onClick={() => void query.refetch()}>
          再試行
        </button>
      </p>
    );
  }
  return null;
}
