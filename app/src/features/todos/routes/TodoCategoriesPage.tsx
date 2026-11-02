import { useSetAtom } from "jotai";
import { statusMessageAtom } from "../../../shared/state/status";
import { TodoCategoryManager } from "../components/TodoCategoryManager";

export function TodoCategoriesPage() {
  const setStatus = useSetAtom(statusMessageAtom);
  return (
    <section className="mt-2 w-full min-w-0 px-2 py-3 md:mt-4 md:px-6 md:py-6">
      <h2 className="text-lg font-semibold text-heading">カテゴリー管理</h2>
      <p className="mt-2 text-sm text-secondary">
        ToDoで使うカテゴリーを追加・名前変更・削除・並べ替えできます。
      </p>
      <TodoCategoryManager setStatus={setStatus} />
    </section>
  );
}
