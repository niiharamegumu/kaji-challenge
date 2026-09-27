import { TodoCategoryQueryStatus } from "./TodoCategoryQueryStatus";
import { useState } from "react";
import { useTodoCategoryMutations, useTodoCategoriesQuery } from "../hooks/useTodoCategories";

export function TodoCategoryManager({ setStatus }: { setStatus: (message: string) => void }) {
  const query = useTodoCategoriesQuery();
  const { createCategory, removeCategory } = useTodoCategoryMutations(setStatus);
  const [name, setName] = useState("");
  const pending = createCategory.isPending || removeCategory.isPending;
  return (
    <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4 md:p-6">
      <p className="mt-3 text-xs text-stone-600">
        0件でもカテゴリーは残ります。カテゴリーを削除してもToDoは残り、未分類になります。
      </p>
      <div className="mt-2">
        <TodoCategoryQueryStatus query={query} />
      </div>
      <form
        className="mt-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim() || pending) return;
          try {
            await createCategory.mutateAsync(name.trim());
            setName("");
          } catch {
            /* Keep the input so it can be retried. */
          }
        }}
      >
        <fieldset disabled={pending} className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 flex-1 gap-1 text-xs text-stone-700">
            新しいカテゴリー
            <input
              className="h-10 min-w-0 rounded-lg border border-stone-300 px-3 text-sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={50}
              placeholder="例: 買い物リスト、やることリスト"
            />
          </label>
          <button
            type="submit"
            disabled={!name.trim() || pending}
            className="min-h-10 rounded-lg bg-stone-900 px-3 text-sm text-white disabled:opacity-50"
          >
            {createCategory.isPending ? "追加中…" : "カテゴリーを追加"}
          </button>
        </fieldset>
      </form>
      {createCategory.isError || removeCategory.isError ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          保存に失敗しました。もう一度お試しください。
        </p>
      ) : null}
      <ul className="mt-3 grid gap-2">
        {(query.data ?? []).map((category) => (
          <li
            key={category}
            className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-stone-50 px-3 py-2"
          >
            <span className="min-w-0 break-words text-sm">{category}</span>
            <button
              type="button"
              disabled={pending}
              onClick={() => removeCategory.mutate(category)}
              aria-label={`${category} を削除`}
              className="min-h-9 shrink-0 rounded-lg border border-stone-300 px-3 text-xs text-stone-700 disabled:opacity-50"
            >
              削除
            </button>
          </li>
        ))}
      </ul>
      {query.isSuccess && query.data.length === 0 ? (
        <p className="mt-2 text-xs text-stone-500">カテゴリーはまだありません。</p>
      ) : null}
    </div>
  );
}
