---
name: kaji-pr-prep
description: KajiChalle の変更を commit や pull request に出す前に使う。status 確認、検証選択、生成差分確認、日本語 PR summary、リスク報告を扱う。
---

# Kaji PR Prep

commit、push、pull request 作成の前に使います。

1. `git status --short` を確認する。
2. Codex の変更と、ユーザーの無関係な変更を分けて扱う。無関係な変更は revert しない。
3. diff で以下を確認する。
   - 意図しない generated-file drift
   - secret や credential
   - architecture boundary violation
   - 変更挙動に対する missing tests
4. 変更に応じた検証を実行する。
   - docs/config のみ: syntax validation がない限り runtime tests は不要
   - TS server/DB: `cd app && bun run test:server --run`（専用TEST_DATABASE_URL）
   - frontend: `make test`
   - architecture/import movement: `make architecture-check`
   - 現用API: `app/src/contracts` の契約テスト・型検査
   - build・型・lint・UI: `make check`
   - high-risk cross-stack: `cd app && bun run test:local`
5. 簡潔な日本語 PR title と body を用意する。
   - 概要
   - 変更内容
   - 確認方法
   - リスク/補足
6. 実行しなかったコマンドと残るリスクを報告する。
