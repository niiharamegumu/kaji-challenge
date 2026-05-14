---
name: kaji-review
description: KajiChalle の差分レビュー、PR前レビュー、backend/frontend 実装レビューで使う。差分に応じて backend_reviewer / frontend_reviewer subagent を使い、Correctness、Best Practice、Architecture、Testability、Security、Operations、Spec の観点で取りまとめる。
---

# Kaji Review

KajiChalle の変更レビュー用 skill です。レビュー依頼時に差分を分類し、必要な reviewer を起動したうえで、カテゴリ別テーブルに取りまとめます。

## 前提

- ファイル編集はしない。レビューと取りまとめに徹する。
- `AGENTS.md`、`docs/architecture.md`、`docs/testing.md`、`docs/codex-workflow.md` を source of truth とする。
- 言語・フレームワークの best practices もレビュー対象に含める。
- subagent は、ユーザーがレビューや並列確認を依頼した場合に使う。

## 差分分類

まず `git status --short` と必要な diff を確認し、変更ファイルを分類する。

- Backend:
  - `backend/**/*.go`
  - `backend/**/*.sql`
  - `backend/migrations/**`
  - `backend/Dockerfile`
  - backend の config / generated / test 変更
- Frontend:
  - `frontend/**/*.{js,jsx,ts,tsx,mjs,cjs}`
  - `frontend/package.json`
  - `frontend/vite.config.*`
  - `frontend/vitest.config.*`
  - `frontend/wrangler.toml`
  - frontend の config / generated / test 変更
- スペック:
  - `api/openapi.yaml`
  - generated API client/server types
  - `docs/**`
  - `.codex/specs/**`
- セキュリティ:
  - auth/session/cookie/OIDC/CORS/CSRF/authorization/input validation/secrets に影響する変更
- 運用:
  - deploy、Cloud Run、Cloudflare Workers、DB migration、jobs、通知、Makefile、CI、runtime config に影響する変更

## Reviewer 起動方針

- Backend 対象がある場合は `.codex/agents/backend_reviewer.toml` の reviewer を使う。
- Frontend 対象がある場合は `.codex/agents/frontend_reviewer.toml` の reviewer を使う。
- API/security/operations/spec 影響は、backend/frontend reviewer の findings と親 Codex の整理を合わせて分類する。
- reviewer は read-only とし、修正実装はしない。

## Backend Review 観点

backend review では以下の repo skills の観点を使う。

- `golang-http-frameworks`
- `golang-testing`
- `openapi-spec-generation`
- `api-security-best-practices`
- `auth-implementation-patterns`
- `database-schema-designer`
- `gcp-cloud-run`

重点観点:

- Go idiom、error handling、context propagation、time/date handling、transaction handling、concurrency
- Gin/OpenAPI transport boundary、status code、cookie/header、request/response mapping
- Clean Architecture、usecase orchestration、ports/adapters、sqlc/PostgreSQL boundary
- DB constraint、migration safety、index、team scoping、authorization、idempotency
- testability、table-driven tests、DB integration tests、regression coverage

## Frontend Review 観点

frontend review では以下の repo skills の観点を使う。

- `vercel-react-best-practices`
- `vitest`
- `workers-best-practices`
- `openapi-spec-generation`
- `api-security-best-practices`
- `auth-implementation-patterns`

重点観点:

- React component 設計、hooks、state/query 管理、render performance、side effects
- TypeScript 型設計、null/undefined handling、API response handling
- Feature-Based Architecture、feature public API、shared placement、generated client boundary
- loading/empty/error/success state、user-visible behavior、accessibility の基本
- Vitest/Testing Library の testability、regression coverage
- Cloudflare Workers runtime、environment variables、fetch/proxy/config、PWA/push 影響

## 出力形式

最終回答では、起動した reviewer と対象分類を短く述べたうえで、必ず以下の5テーブルを出す。

### Backend 観点

| ID | 重要度 | 分類 | 対象 | 指摘 | 根拠 | 推奨対応 |
|---|---|---|---|---|---|---|
| B1 | High/Medium/Low | Correctness/Best Practice/Architecture/Testability/Security/Operations/Spec | file:line | 内容 | 根拠 | 対応 |

### Frontend 観点

| ID | 重要度 | 分類 | 対象 | 指摘 | 根拠 | 推奨対応 |
|---|---|---|---|---|---|---|
| F1 | High/Medium/Low | Correctness/Best Practice/Architecture/Testability/Security/Operations/Spec | file:line | 内容 | 根拠 | 対応 |

### セキュリティ観点

| ID | 重要度 | 分類 | 対象 | 指摘 | 根拠 | 推奨対応 |
|---|---|---|---|---|---|---|
| セキュリティ1 | High/Medium/Low | Security | file:line | 内容 | 根拠 | 対応 |

### 運用観点

| ID | 重要度 | 分類 | 対象 | 指摘 | 根拠 | 推奨対応 |
|---|---|---|---|---|---|---|
| 運用1 | High/Medium/Low | Operations | file:line | 内容 | 根拠 | 対応 |

### スペック観点

| ID | 重要度 | 分類 | 対象 | 指摘 | 根拠 | 推奨対応 |
|---|---|---|---|---|---|---|
| スペック1 | High/Medium/Low | Spec | file:line | 内容 | 根拠 | 対応 |

該当カテゴリに指摘がない場合は、1行で `該当なし` と書く。

## 取りまとめルール

- findings は重大度順に並べる。
- 同じ問題が複数カテゴリにまたがる場合は、主カテゴリに置き、必要なら別カテゴリで横断リスクとして再掲する。
- style-only の指摘は、maintainability、correctness、testability の実害がある場合だけ出す。
- 推奨対応は実装者が次に何をすべきか分かる粒度にする。
- 最後に、未確認のコマンドや残るリスクを短く書く。
