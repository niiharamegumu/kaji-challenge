import { useSetAtom } from "jotai";
import { statusMessageAtom } from "../../../shared/state/status";
import { TodoCategoryManager } from "../components/TodoCategoryManager";

export function TodoCategoriesPage() {
  const setStatus = useSetAtom(statusMessageAtom);
  return (
    <section className="mt-2 w-full min-w-0 px-2 py-3 md:mt-4 md:px-6 md:py-6">
      <h2 className="text-lg font-semibold text-stone-900">カテゴリー管理</h2>
      <p className="mt-2 text-sm text-stone-600">ToDoで使うカテゴリーを追加・削除できます。</p>
      <TodoCategoryManager setStatus={setStatus} />
    </section>
  );
}
