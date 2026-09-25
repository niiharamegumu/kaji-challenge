# データベースの責務

Cloudflare D1に19テーブルを持つ。ユーザー情報の正本はBetter Authの `auth_user`。旧アプリ用 `users` は削除し、メール・表示名・作成日時の二重保存と同期処理をなくした。

| 領域 | テーブル | 残す理由 |
| --- | --- | --- |
| ユーザー | `auth_user` | ID・メール・名前・作成日時と、アプリ用nickname/color_hexを一元管理 |
| Google連携 | `auth_account` | Googleのsubject、暗号化したOAuthトークン。userとは別の外部認証アカウント |
| セッション | `auth_session` | Cookieに対応するログイン状態、失効・30日・最大5件の制御 |
| OAuth state | `auth_verification` | Google往復時のstate/PKCE等の一時情報。メール認証を無効にしても必要 |
| 認証リクエスト制限 | `auth_rate_limit` | Workerをまたいで共有する認証APIのレート制限 |
| チーム | `teams`・`team_members`・`invite_codes` | チーム名、owner/member権限、所属と招待。Better Authのorganization pluginは利用しない |
| 家事 | `tasks` | 家事定義、担当、並び順、論理削除 |
| 日次完了 | `task_completion_daily` | 1家事・1日に最大1件という制約 |
| 週次完了 | `task_completion_weekly_entries` | 1週間に複数回の完了・実行者・取り消す順番。日次と制約が異なる |
| 買い物・予定 | `shopping_items`・`reminders` | 独立した業務データ |
| ペナルティ | `penalty_rules` | 適用条件と論理削除 |
| 月次確定 | `monthly_penalty_summaries`・`monthly_penalty_summary_triggered_rules` | 月次合計・締め状態・締め時点の発動ルールID。現在の定義だけからは確定状態を再現できない |
| 締め台帳 | `close_runs` | 日次/週次の処理済み期間を記録し、補完・再実行時の二重計上を防止 |
| Push | `push_subscriptions`・`push_delivery` | 購読と配信枠・lease・送信成功を分離。同じ枠の成功済み購読への再送を防止 |

Better Authの標準カラムは、Googleログインで通常使わない `password` などもadapterとの互換性のため保持する。`id_token` はhookで非保存にしている。テーブルを減らすために認証のstateやレート制限をCookie・メモリーへ移さない。

## プロフィール更新

`nickname` / `colorHex` はBetter Authの `additionalFields` で `input:false` にする。認証APIへの直接入力を拒否し、アプリのServer Functionsで所属・入力内容を確認して更新する。表示用DTOは従来どおりISO日時を返す。

Better Authがユーザーを作成した後、セッション作成hookで初期チームとowner所属を作る。所属の存在を初期設定の完了として扱い、同時ログインや途中失敗時にもチームを重複作成しない。

## migration

適用済みの `0001_initial.sql` は保持する。`0002_unify_users.sql` はnickname/colorをauth_userへ移し、ユーザーを参照する外部キーを付け替える。SQLiteの親テーブル削除によるCASCADEを避けるため、影響する6テーブルだけ一時コピーし、子から削除・親から再作成・データ復元する。完了後は旧usersと一時テーブルを削除する。

ローカルはWrangler、本番はAlchemyの適用履歴で管理する。既存データを入れたD1で、担当・完了履歴・Push成功記録・セッションの保持と外部キー整合性を検証する。

Better Authの追加項目と入力制御は [公式Databaseガイド](https://better-auth.com/docs/concepts/database) に従う。OAuth stateの保存先は `storeStateStrategy: "database"` として明示する。

## Drizzleによるアクセス

`app/src/server/infrastructure/schema.ts` が業務14テーブル、`auth-schema.ts` が認証5テーブルの実行時定義です。`database.ts` でリクエスト単位のDB handleを作り、Repository・Better Auth・Pushへ渡します。通常のCRUDはquery builder、再帰CTE等はパラメーター化したDrizzle `sql` を使用します。

SQL migrationがDDLの正本です。schemaの変更だけではDBは更新されないため、今後の列・制約の変更では新しいmigrationとDrizzle定義を一緒に更新し、`drizzle-schema.test.ts` で照合してください。

## 日時の保存形式

すべてのアプリ管理の日時列はUTCの固定形式 `YYYY-MM-DDTHH:mm:ss.sssZ`（TEXT）で保存する。日付のみの列は `YYYY-MM-DD` のまま。認証日時は `auth-schema.ts` のDrizzle customTypeで `Date` と相互変換し、Better Authの `lastRequest` だけはライブラリが期待する数値のUnixミリ秒と相互変換する。DB上はどちらも同じISO文字列。Pushの `lease_until` / `sent_at` もISO文字列で比較・保存する。

`0003_iso_timestamps.sql` は既存ミリ秒値を精度を保って変換し、nullable日時のNULLも維持する。auth_userの置換でCASCADE/SET NULLが発生しないよう、認証5テーブルと依存する業務6テーブルを退避し、子から削除・親から復元する。5セッション制限triggerは復元後に再作成する。migrationはファイル全体を原子的に適用する。

既存DBへの適用は旧コードからの書き込みを止めてから行う。ローカルは開発サーバー停止後に `cd app && mise exec -- bun run db:migrate`、その後サーバーを再起動する。本番ではメンテナンス・Cron停止中に同じリリースのSQLとWorkerを配備する。旧コードは数値形式を前提にしているため、SQL適用後に旧Workerを継続稼働させない。

日時変換は [Drizzle customType](https://orm.drizzle.team/docs/custom-types) を使用する。D1で親テーブルを削除すると、外部キーの遅延検証だけではCASCADEを防げない（[Cloudflare公式](https://developers.cloudflare.com/d1/sql-api/sql-statements/)）。

## revision制御の撤去

`0004_remove_revisions.sql` は `teams.state_revision` と `app_revision` を削除する追加migration。タスク・完了・チーム・セッション等の既存データは維持する。新しいrevision・操作ID・通知番号のテーブルは作らない。リアルタイムの接続一覧はDOのWebSocket attachmentから作り、D1には保存しない。

旧Workerはこの列を参照するため、旧版をメンテナンス・Cron無効にして実行中の更新が終わってから適用する。SQL適用後は旧Workerへコードだけrollbackしない。新Workerを同じ停止設定で配備・確認し、再開する。詳しい手順はlocal-notes/operations/deployment-guide.mdを参照。
