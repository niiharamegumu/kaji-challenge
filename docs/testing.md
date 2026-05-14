# テスト方針

このドキュメントは、このリポジトリのテスト設計方針を定義します。
`AGENTS.md`、`docs/architecture.md`、該当する repo skill と合わせて使います。

## 目的

- 挙動を観測できる最小の有効な層でテストする。
- 広い E2E よりも、決定的で安定したテストを優先する。
- ローカルで再現できる bug fix には regression test を追加する。
- API contract とアーキテクチャ境界に沿ったテストにする。

## Backend

Backend のテストは Go 標準の test runner を使います。

- Domain tests は、DB、HTTP、Gin、OpenAPI generated types、sqlc に依存しない純粋な business rule と validation を対象にする。
- Usecase tests は、orchestration、authorization 判定、日付境界、冪等性、ports/fakes 経由の error mapping を対象にする。
- Persistence tests は、PostgreSQL/sqlc の挙動、制約、transaction、ordering、team scoping を isolated database で確認する。
- Transport tests は、request/response mapping、cookie、header、status code、OpenAPI boundary type、auth/session、precondition error を対象にする。
- validation、日付ロジック、状態遷移 matrix は table-driven tests を優先する。
- PostgreSQL に触れるテストは `TEST_DATABASE_URL` を使う。Makefile は local/Compose 実行向けの default を提供する。

## Frontend

Frontend のテストは Vitest と Testing Library を使います。

- 実装詳細より user-visible behavior を優先する。
- Feature tests は、`src/features/<feature>/index.ts` から export された public API を検証する場合を除き、feature 境界内に留める。
- Component / route tests は、利用可能なら `src/test` の shared test helper を使う。
- API mock は feature/api boundary または shared API mock layer で行う。production code がその境界を使っていない限り、UI tests に generated client types を直接 import しない。
- UI 変更が user flow に影響する場合、loading、empty、success、validation、recoverable error state を必要に応じて追加する。
- 同期や競合処理では、該当する場合 `412 precondition_failed`、`428 precondition_required`、refresh/retry UI behavior を含める。

## API Contract

- `api/openapi.yaml` を API shape の source of truth とする。
- API 挙動を変える場合は、生成コードや実装より先に OpenAPI を更新する。
- 生成ファイルは `make gen`、または狭い `make gen-backend` / `make gen-frontend` で更新する。
- contract 影響がある変更では、変更 endpoint に対する backend transport coverage と frontend adapter/hook coverage を含める。
- 生成コードの整合性が主なリスクの場合は `make diff-gen` を実行する。

## 検証コマンドの選び方

最も狭く信頼できる検証を選びます。

- Backend のみの挙動: `make test-backend`
- Frontend のみの挙動: `make test-frontend`
- import 境界や package 移動: `make architecture-check`
- API/schema 挙動: `make gen`、対象テスト、必要に応じて `make diff-gen`
- cross-stack または release-sensitive な変更: `make check`

コマンドを実行できない場合は、理由と残るリスクを報告します。
