import type { TodoCategoriesQuery } from "../hooks/useTodoCategories";
import { TodoCategoryQueryStatus } from "./TodoCategoryQueryStatus";

export type TodoCategorySelection =
  | { kind: "all" }
  | { kind: "unclassified" }
  | { kind: "category"; name: string };

export function TodoCategoryFilter({
  categoriesQuery,
  value,
  onChange,
}: {
  categoriesQuery: TodoCategoriesQuery;
  value: TodoCategorySelection;
  onChange: (value: TodoCategorySelection) => void;
}) {
  const options: { value: TodoCategorySelection; label: string }[] = [
    { value: { kind: "all" }, label: "すべて" },
    ...(categoriesQuery.data ?? []).map((name) => ({
      value:
        name === null ? { kind: "unclassified" as const } : { kind: "category" as const, name },
      label: name ?? "未分類",
    })),
  ];
  return (
    <>
      <div
        role="group"
        aria-label="カテゴリーで絞り込み"
        className="mt-2 flex w-full min-w-0 max-w-full gap-2 overflow-x-auto overscroll-x-contain px-2 pb-1 md:px-0"
      >
        {options.map((option) => {
          const selected =
            value.kind === option.value.kind &&
            (value.kind !== "category" ||
              (option.value.kind === "category" && value.name === option.value.name));
          return (
            <button
              key={
                option.value.kind === "category"
                  ? `category:${option.value.name}`
                  : option.value.kind
              }
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={`min-h-8 shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500 ${selected ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-600 hover:bg-stone-100"}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div className="px-2 md:px-0">
        <TodoCategoryQueryStatus query={categoriesQuery} />
      </div>
    </>
  );
}
