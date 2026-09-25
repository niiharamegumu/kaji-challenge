---
name: kaji-api-change
description: KajiChalleのServer Functions・Zod契約・feature API adapterを変更するときに使う。TS契約と実装の整合性を検証する。
---

# Kaji API Change

`AGENTS.md`、`docs/architecture.md`、`docs/testing.md` に従う。

- 現用の契約は `app/src/contracts/`。入力schema・DTO・出力schemaを先に確認して変更し、Server Function、Application、feature adapterの整合性を保つ。
- session、origin、チーム所属/owner権限をサーバー側で検証する。複合更新は用途別Repository操作のD1 atomic batchで行い、変わり得る条件をSQLで検査する。revision・ETag・更新再試行を追加しない。保存後のWebSocket通知失敗は保存失敗にしない。
- transportは入力・認証・エラー変換、Application/Domainは業務規則、infrastructureはDB/外部サービスを担当する。
- 競合/前提不足、認証失効、越境拒否、入力不正、出力schemaを契約テスト・専用DBテストで確認する。画面に影響する変更はadapter/hook/componentで確認する。
- 対象テストを選び、appの型・build・lint・境界を確認する。DB/ブラウザーを含む全体確認には `cd app && bun run test:local` を使う。

変更した契約・挙動、検証結果、未確認事項を報告する。
