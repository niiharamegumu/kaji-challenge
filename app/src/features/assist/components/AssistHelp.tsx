import { CircleHelp } from "lucide-react";
import { useId, useState } from "react";

export function AssistHelp() {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <details
      className="assist-help"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.currentTarget.open) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary
        className="assist-icon-button"
        role="button"
        aria-label="できること"
        aria-expanded={open}
        aria-controls={contentId}
        tabIndex={0}
      >
        <CircleHelp size={21} strokeWidth={1.8} aria-hidden="true" />
      </summary>
      <section
        id={contentId}
        className="assist-help-content"
        aria-label="アシストでできること"
        tabIndex={0}
      >
        <h2>できること</h2>
        <h3>ToDo</h3>
        <dl>
          <dt>追加</dt>
          <dd>「ToDoに牛乳と卵を追加して」</dd>
          <dt>カテゴリー・名前で検索</dt>
          <dd>「買い物リストを見せて」「買い物の牛乳を探して」</dd>
          <dt>完了・削除</dt>
          <dd>「牛乳を買った」「卵を削除して」</dd>
          <dt>まとめて操作</dt>
          <dd>「塩は購入した、レモンを追加して」</dd>
        </dl>
        <p>追加先は内容から推測し、迷うときは確認します。</p>
        <p>
          完了・削除は同じ名前のToDoをすべて対象にします。カテゴリーを指定すると、その中だけが対象です。
        </p>
        <p>一覧は先頭20件まで。続きや編集はToDo画面で確認できます。</p>
      </section>
    </details>
  );
}
