# kaji-challenge

家事管理アプリのモノレポひな形です。

- frontend: React + Vite + TypeScript（Cloudflare Workers 配備前提）
- backend: Go + Gin（Cloud Run 配備前提）
- api: OpenAPI SSOT

## ディレクトリ構成

- `frontend/`: SPA
- `backend/`: API
- `api/`: OpenAPI と codegen 設定

## 前提ツール

- Docker / Docker Compose
- Node.js 22+
- Go 1.24+
- GNU Make

## 開発コマンド

- `make up`: PostgreSQL 起動
- `make down`: コンテナ停止（volumeは保持）
- `make down-reset`: コンテナ停止 + volume削除（DB初期化）
- `make dev`: frontend/backend/postgres を Compose で起動（ログ追従）
- `make gen`: OpenAPI から frontend/backend 生成
- `make lint`: frontend/backend lint
- `make test`: frontend/backend test
- `make security`: backend/frontend の脆弱性チェック（Critical fail）
- `make check`: `gen + lint + test`
- `make diff-gen`: 生成差分チェック

## OpenAPI SSOT

- 仕様: `api/openapi.yaml`
- frontend 生成: `orval` (`frontend/src/lib/api/generated/client.ts`)
- backend 生成: `oapi-codegen` (`backend/internal/openapi/generated/openapi.gen.go`)

APIを変更する場合は、必ず `api/openapi.yaml` を先に更新してから `make gen` を実行してください。

## ローカル開発（Compose）

- `make up`: バックグラウンド起動
- `make dev`: フォアグラウンド起動（ログ確認用）
- frontend: `http://localhost:5173`
- backend: `http://localhost:8080`
- postgres: `localhost:5432`

backend は `air` で起動され、`backend/` 配下の変更を自動リロードします。
`DATABASE_URL` は全環境で必須です（未設定時は backend 起動失敗）。

## Frontend (Cloudflare Workers)

- デプロイ: `cd frontend && npm run deploy`
- 設定: `frontend/wrangler.toml`

必要な環境変数:

- `VITE_API_BASE_URL`: backend API のベースURL

GitHub Actions デプロイで必要な secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Backend (Cloud Run)

- Docker build: `docker build -t kaji-backend ./backend`

GitHub Actions デプロイで必要な secrets:

- `GCP_PROJECT_ID`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`
- `DATABASE_URL`（migration実行用）

Cloud Run の初期設定:

- Region: `us-central1`
- Service: `kaji-backend`
- Deploy mode: `--allow-unauthenticated`（アプリ層で認証）

OIDC厳格運用（推奨）:

- `OIDC_STRICT_MODE=true` を設定すると、`OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URL` が未設定の場合にbackendは起動失敗します。
- `OIDC_STRICT_MODE=true` ではローカルモック認証分岐は無効化されます。

## Git Hooks

- 設定: `lefthook.yml`
- pre-commit で `make lint` を実行
- pre-push で `make check`（`gen + lint + test`）を実行

初回セットアップ:

```bash
cd frontend && npm ci
cd ..
lefthook install
```

`lefthook` 未インストールの場合は、先にインストールしてください（例: `brew install lefthook`）。
