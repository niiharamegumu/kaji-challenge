import { useId } from "react";
import type { TodoCategoriesQuery } from "../hooks/useTodoCategories";
import { TodoCategoryQueryStatus } from "./TodoCategoryQueryStatus";

export function TodoCategoryInput({
  value,
  onChange,
  categoriesQuery,
}: {
  value: string;
  onChange: (value: string) => void;
  categoriesQuery: TodoCategoriesQuery;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-2">
      <label className="text-xs text-stone-700 sm:text-sm" htmlFor={id}>
        カテゴリー（任意）
      </label>
      <select
        id={id}
        value={categoriesQuery.data === undefined ? "" : value}
        disabled={categoriesQuery.data === undefined}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
      >
        {categoriesQuery.data === undefined ? (
          <option value="">
            {categoriesQuery.isPending ? "読み込み中…" : "取得できませんでした"}
          </option>
        ) : null}
        {categoriesQuery.data?.map((name) => (
          <option key={name === null ? "unclassified" : `category:${name}`} value={name ?? ""}>
            {name ?? "未分類"}
          </option>
        ))}
      </select>
      <TodoCategoryQueryStatus query={categoriesQuery} />
    </div>
  );
}
