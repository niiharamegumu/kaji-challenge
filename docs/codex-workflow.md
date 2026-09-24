# Codex Workflow

このドキュメントは、このリポジトリで Codex の繰り返し作業をどう整理するかを定義します。

## Guidance Layers

- root `AGENTS.md`: 常時読む短いリポジトリ規約。
- `docs/architecture.md`: アーキテクチャ詳細と import 境界ルール。
- `docs/testing.md`: テスト設計と検証コマンドの選び方。
- `.agents/skills/*/SKILL.md`: Codex が明示または暗黙に使える再利用ワークフロー。
- `.codex/rules/*.rules`: command approval policy 専用。
- `.codex/agents/*.toml`: 明示的に委譲する project-scoped custom subagent。
- `local-notes/records/*`: タスク単位の調査、計画、結果の記録（Git管理外）。

長い設計方針を `.codex/rules` に入れないでください。Rules は command approval decision のためのものです。

## Spec を作る基準

複数ファイルにまたがる変更、API 挙動変更、アーキテクチャ境界への影響、データモデル挙動の変更、
または実装前の承認が必要な非自明な作業では `local-notes/records/YYYY-MM-DD-short-title/` を使います。

個人用資料は `local-notes/` に集約します。実装解説は `guides/`、起動・配備手順は
`operations/`、作業記録は `records/`、ログ・画像などの検証証跡は `verification/` に保存します。アプリ・ビルド・CIの入力にはしません。
リポジトリ共通の設計・テスト規約、README、実行に必要な設定例は引き続きGitで管理します。

各 spec には以下を含めます。

- `Task.md`: ユーザーの目的、現状の事実、制約、成功条件。
- `Plan.md`: 実装計画、検証計画、リスク、前提。
- `Result.md`: 変更ファイル、変更した挙動、検証結果、follow-up。

小さな単一ファイル修正では、ユーザーが求めない限り spec は不要です。

## Skill Usage

繰り返し使うワークフローには repo skill を使います。

- `$kaji-api-change`: Zod API contract とadapter変更。
- `$kaji-test-design`: test strategy と regression coverage。
- `$kaji-architecture-check`: dependency boundary と構造変更。
- `$kaji-pr-prep`: 最終検証と PR 準備。

TypeScript/Zod、React/Vitest、auth/security、Cloudflare Workers などの外部専門知識が必要な場合は、インストール済みの汎用 skill も使います。

## Subagent Usage

subagent は、ユーザーが並列作業や agent への委譲を明示した場合だけ使います。

推奨する project agent:

- `architect`: read-only の architecture / dependency boundary 調査。
- `test_designer`: read-only の testing gap analysis と scenario design。
- `reviewer`: correctness、security、regression、missing tests を重視する read-only review。

実装には、project-specific な実装 agent が必要になるまでは built-in `worker` を使います。

## PR 準備

PR 作成前に以下を確認します。

- `git status --short` を確認し、ユーザーの無関係な変更と Codex の変更を分けて扱う。
- 変更範囲に応じた検証を実行する。
- API/schema を変更した場合は、生成ファイルが最新であることを確認する。
- リスクと未実行チェックを明確にまとめる。
- ユーザーが別途指定しない限り、日本語の PR title と構造化された日本語 PR body を使う。
