# ToDoカテゴリーIDへの手動変換

既存DBでは **書き込み停止 → 手動変換 → 0007を含む配備 → 検証 → 再開** の順に実施する。通常のmigrationはDDLだけで、名前からIDへの変換は自動実行しない。新規DBは変換不要。

## 変換内容

- `teams.todo_categories` の名前配列を固定UUID付きの `{ id, name }` 配列へ変換し、未分類をnullとして含める。
- `todo_items.category` の名前を対応するIDへ置き換える。ID・内容・メモ・順序・日時・未分類ToDoは変更しない。
- 0006適用済みなら `todo_unclassified_sort_key` の位置へnullを挿入する。0005までのDBでは先頭へ挿入する。
- 変換済みのチームはID・名前・順序・関連を検査してスキップする。再実行してもIDを振り直さない。
- 全チームを事前検査し、重複名・不正形式・未登録カテゴリーへの参照があれば書き込み前に停止する。適用はチームごとのD1 atomic batch。途中失敗時は完了チームが残るため、原因解消後に再実行する。

## ローカル

開発サーバーを停止し、`.wrangler/state` を退避してから `app/` で実行する。Vite/Wranglerの標準保存先 `.wrangler/state/v3` を使用する。

```sh
mise exec -- bun scripts/convert-todo-category-ids.ts --local
mise exec -- bun scripts/convert-todo-category-ids.ts --local --apply
mise exec -- bun run db:migrate
mise exec -- bun scripts/convert-todo-category-ids.ts --local
```

最初はdry-run（検査・対象チーム数のみ）、`--apply` で明示的に書き込む。最後の検査で `converted: 0` を確認してから新コードで開発サーバーを起動する。

## 本番

1. 対象D1のバックアップ/Time Travelの復元点を確保する。旧Workerをメンテナンスにし、Cronを停止して実行中の書き込みが終わるまで待つ。
2. `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_DATABASE_ID`、対象D1を読み書きできる `CLOUDFLARE_API_TOKEN` を実行環境へ設定する。トークンはファイルやログ、コマンド本文に記載しない。
3. `app/` でdry-runし、対象件数と対象DBを確認してから適用する。

```sh
mise exec -- bun scripts/convert-todo-category-ids.ts --remote
mise exec -- bun scripts/convert-todo-category-ids.ts --remote --apply
```

4. メンテナンスを維持したまま、0007を含む新しいWorkerを通常のAlchemy配備で反映する。main更新でCDが動くため、手動変換が必要なDBではマージより前に停止と変換を済ませる。
5. 同じスクリプトを `--remote`（`--apply` なし）で再実行し、`converted: 0` を確認する。ホーム/ToDoの関連、カテゴリーの順番、未分類の位置を確認して再開する。

## 失敗・復旧

変換開始後は旧Workerで書き込みを再開しない。途中失敗はメンテナンスのまま原因を修正して再実行する。変換前へ戻す場合は旧コードだけでなくDBも変換前の復元点へ戻す。

0007を先に適用すると旧位置カラムが失われる。名前形式が残っている場合、スクリプトは推測で位置を決めず停止する。0007適用前のバックアップと停止期間中の状態を確認して復旧し、正しい順序で実行する。

スクリプトはリモートでCloudflare公式[D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)のbatchを使う。認証情報やカテゴリー内容は出力せず、対象件数と実行結果だけを表示する。本番の権限・バックアップ・配備確認はローカルD1のテストで代替しない。
