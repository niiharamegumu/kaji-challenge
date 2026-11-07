import { useSetAtom } from "jotai";
import { InfoHelp } from "../../../shared/components/InfoHelp";
import { statusMessageAtom } from "../../../shared/state/status";
import { TodoCategoryManager } from "../components/TodoCategoryManager";

export function TodoCategoriesPage() {
  const setStatus = useSetAtom(statusMessageAtom);
  return (
    <section className="mt-2 w-full min-w-0 px-2 py-3 md:mt-4 md:px-6 md:py-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-heading">カテゴリー管理</h2>
        <InfoHelp label="カテゴリー管理の使い方">
          <p>ToDoのカテゴリーを追加・名前変更・削除できます。</p>
          <p>
            右のハンドルをドラッグすると、未分類も含めて表示順を変更できます。スマホでは長押しして動かします。
          </p>
          <p>
            ToDoが0件になってもカテゴリーは残ります。カテゴリーを削除すると、そのToDoは未分類に移ります。
          </p>
        </InfoHelp>
      </div>
      <TodoCategoryManager setStatus={setStatus} />
    </section>
  );
}
