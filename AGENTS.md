# AGENTS.md

## Scope
このファイルは、Codex が自動で読み込むリポジトリ共通の作業規約を定義します。

アプリの実装・SQL・インフラの正本は `app/` です。
- `app/`: TanStack Start SPA + React + TypeScript（Cloudflare Workers）

## Instruction Priority
1. チャットでのユーザー指示
2. 編集対象に最も近い `AGENTS.md` / `AGENTS.override.md`
3. 親ディレクトリまたは root の `AGENTS.md`

将来サブプロジェクト固有の指示を追加する場合は、対象に最も近いファイルを優先します。

## Operating Principles
- 変更は小さく、具体的で、検証可能に保つ。
- 構造変更やテスト影響がある変更の前に、該当するアーキテクチャ・テスト文書を読む。
- 完了前に、変更範囲に対して最も狭く信頼できる検証を実行する。
- APIキーや認証情報をコード、ログ、ドキュメント、コミット、PR本文に出さない。
- 権限昇格や副作用のあるコマンドは、承認を求める前に内容を慎重に確認する。

## Required Project Rules
- アーキテクチャ: app/src/server は Clean Architecture、UI は Feature-Based Architecture に従う。構造変更、package 移動、import 境界変更の前に `docs/architecture.md` を読む。
- API: 内部通信の正本は `app/src/contracts/` の入力schema・DTO・出力schemaと契約テスト。SQLは `app/migrations/` で管理する。
- テスト: server、UI、統合テスト、API contract の設計は `docs/testing.md` に従う。
- ワークフロー: spec-first 作業、検証、PR準備、repo skill / subagent の使い分けは `docs/codex-workflow.md` に従う。

## Common Commands
- ローカル起動: `make dev`
- lint: `make lint`
- アーキテクチャチェック: `make architecture-check`
- test: `make test`
- アプリのbuild・型・format・lint・UI検証: `make check`
- DB・ブラウザーを含む一括検証: `cd app && bun run test:local`

## Definition of Done
タスクは、該当する項目を満たしたときに完了とします。
- 変更範囲の build/type/lint/test が通っている。
- API/schema を変更した場合、生成ファイルが更新されている。
- app の構造や import を変更した場合、アーキテクチャチェックが通っている。
- API/server 変更では security/auth への影響を確認している。
- 最終報告に、変更ファイル、変更理由、検証コマンドと結果、既知のリスクや follow-up を含める。

## Repo Skills and Agents
- 繰り返し使う作業手順には `.agents/skills/` の repo skill を使う。
  - `kaji-api-change`
  - `kaji-test-design`
  - `kaji-architecture-check`
  - `kaji-pr-prep`
- `.codex/agents/` の project subagent は、ユーザーが並列作業や agent への委譲を明示した場合だけ使う。
