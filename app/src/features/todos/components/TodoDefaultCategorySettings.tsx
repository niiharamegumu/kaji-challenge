import { useId, useState } from "react";
import { useTodoCategoriesQuery } from "../hooks/useTodoCategories";
import { useTodoDefaultCategory } from "../hooks/useTodoDefaultCategory";
import { ALL_TODO_CATEGORIES, type TodoCategorySelection } from "../model/defaultTodoCategory";
import { TodoCategoryQueryStatus } from "./TodoCategoryQueryStatus";

function optionValue(selection: TodoCategorySelection) {
  return selection.kind === "category" ? `category:${selection.id}` : selection.kind;
}

export function TodoDefaultCategorySettings({ identityKey }: { identityKey: string }) {
  const query = useTodoCategoriesQuery();
  const [saved, setSaved] = useTodoDefaultCategory(identityKey);
  const [saveFailed, setSaveFailed] = useState(false);
  const inputId = useId();
  const descriptionId = useId();
  const options = [
    { selection: ALL_TODO_CATEGORIES, label: "すべて" },
    ...(query.data ?? []).map((category) => ({
      selection:
        category === null
          ? { kind: "unclassified" as const }
          : { kind: "category" as const, id: category.id },
      label: category?.name ?? "未分類",
    })),
  ];
  const value = saved === undefined ? "all" : optionValue(saved);
  const available = options.some((option) => optionValue(option.selection) === value);
  return (
    <div className="mt-5 grid min-w-0 gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-stone-700">
        最初に表示するToDoカテゴリー
      </label>
      <select
        id={inputId}
        value={available ? value : "all"}
        disabled={query.data === undefined || saved === undefined}
        aria-describedby={descriptionId}
        onChange={(event) => {
          const selected = options.find(
            (option) => optionValue(option.selection) === event.currentTarget.value,
          );
          if (selected) setSaveFailed(!setSaved(selected.selection));
        }}
        className="h-10 min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-60 sm:h-11"
      >
        {options.map((option) => (
          <option key={optionValue(option.selection)} value={optionValue(option.selection)}>
            {option.label}
          </option>
        ))}
      </select>
      <div id={descriptionId} className="space-y-1 text-xs text-stone-500">
        <p>ホームとToDo画面を開いたときに選択されます。タブの並び順は変わりません。</p>
        <p>このブラウザーの、現在のユーザーとチームに自動保存されます。</p>
        <p>削除されたカテゴリーは「すべて」で開きます。</p>
      </div>
      <TodoCategoryQueryStatus query={query} />
      {saveFailed ? (
        <p role="alert" className="text-xs text-red-700">
          このブラウザーに保存できませんでした。もう一度選択してください。
        </p>
      ) : null}
    </div>
  );
}
