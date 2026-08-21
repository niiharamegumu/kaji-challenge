# Plan

1. OpenAPI first で締め候補取得・対象月締め API と過去補正契約を定義する。
2. 月単位集計、締め候補検索、対象期間マーカー補完、原子的な月次締めを実装する。
3. 過去日次・週次・削除済みタスクの補正と締め済み月再確定を実装する。
4. `month-close` feature、共通バナー、サマリー締め確認、warning modal を実装する。
5. 旧 close API、月次 ops scope、月次 Job 定義、不要 DB データを削除する。
6. backend/frontend/contract/architecture を検証し、外部 GCP 撤去手順を Result に記録する。

## Defaults

- JST を日付境界とする。
- 週次は日曜日を含む月へ帰属させる。
- タスク・ルール履歴がない過去月は現在設定で月全体を再計算する。
- 操作監査履歴は追加しない。
