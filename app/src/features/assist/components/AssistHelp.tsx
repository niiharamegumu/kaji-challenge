import { InfoHelp } from "../../../shared/components/InfoHelp";

export function AssistHelp() {
  return (
    <InfoHelp label="アシストの使い方">
      <p>文字で入力するか、マイクで録音して送信できます。音声は文字起こしのために送信されます。</p>
      <dl className="space-y-1 [&_dt]:pt-2 [&_dt]:font-semibold">
        <dt>追加</dt>
        <dd>「ToDoに牛乳と卵を追加して」</dd>
        <dt>メモ付きで追加</dt>
        <dd>「牛乳を追加、低脂肪の1Lを2本」「卵を追加、メモは10個入り」</dd>
        <dt>カテゴリー・名前で検索</dt>
        <dd>「買い物リストを見せて」「買い物の牛乳を探して」</dd>
        <dt>完了・削除</dt>
        <dd>「牛乳を買った」「卵を削除して」</dd>
        <dt>まとめて操作</dt>
        <dd>「塩は購入した、レモンを追加して」</dd>
      </dl>
      <p>追加先は内容から推測し、迷うときは確認します。</p>
      <p>補足は文脈から各ToDoのメモに分けます。対象を省いた「メモは〜」は直前のToDoに付きます。</p>
      <p>
        完了・削除は同じ名前のToDoをすべて対象にします。カテゴリーを指定すると、その中だけが対象です。
      </p>
      <p>一覧は先頭20件まで。続きや編集はToDo画面で確認できます。</p>
    </InfoHelp>
  );
}
