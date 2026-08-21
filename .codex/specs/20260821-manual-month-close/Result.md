# Result

## 実装結果

- 最古の未締め月を取得する API と、`If-Match` 必須の対象月締め API を追加した。
- 手動締め時に日次評価日と「日曜日が対象月に属する」週次評価週を補完し、現在のタスク・ペナルティルールで月全体を原子的に再計算するようにした。
- 全ページ共通バナー、サマリーの締め確認、締め済み月補正時の warning を追加した。
- 全過去の日次・終了済み週次、および対象時点で有効だった削除済みタスクを補正可能にした。
- 旧公開 close API、月次 ops scope、月次 Cloud Run Job のデプロイ定義、`task_evaluation_dedupes` を削除した。日次・週次 Job は対象期間単位のトランザクションにした。

## 検証

- `make gen`: 成功
- `make diff-gen`: 成功（生成差分なし）
- `make check`: 成功
  - backend 全テスト成功
  - frontend 24 files / 100 tests 成功
  - backend/frontend lint、frontend typecheck 成功
  - architecture check 成功（baseline exception 0）

## 本番ロールアウト

1. migration と API/UI のデプロイ中に旧 Job が廃止テーブルへアクセスしないよう、日次・週次・月次の close Scheduler（`kaji-backend-close-month-scheduler-trigger` を含む）を一時停止する。
2. migration `000023_manual_month_close_cleanup`、backend、frontend をデプロイする。
3. 未締め月バナー、候補月サマリー、手動締め、次候補への遷移を本番で確認する。
4. 問題がなければ Scheduler `kaji-backend-close-month-scheduler-trigger` と Cloud Run Job `kaji-backend-close-month` を削除する。
5. 日次・週次 Scheduler を再開し、日次・週次・通知 Jobs と `/app/ops` の稼働を確認する。

外部 GCP リソースの停止・削除は、この実装作業では実行していない。

## 残存リスク

- 過去設定履歴がないため、締めと締め後補正は意図どおり現在設定で再計算され、過去に表示されていた値から変わる可能性がある。
- migration の down は削除済みの重複防止データと `close_month` run を復元できない。
- 監査履歴は追加していないため、誰がいつ補正したかはチーム revision 以外には保存しない。
