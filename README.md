# KajiChalle

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
- `make seed-monthly-dummy month=YYYY-MM email=user@example.com`: ダミータスク/完了記録を投入（集計は行わない）
- `make ops-close scope=day|week|month [team_id=<uuid>]`: close処理をCLI実行（既定は全チーム対象）

backend の Critical 判定は `backend/security/critical_goids.txt` の GO-ID allowlist で管理します。

backend の統合テストは `TEST_DATABASE_URL` を利用して隔離DBを作成して実行します。  
未指定時は `postgres://kaji:kaji@postgres:5432/postgres?sslmode=disable` を既定値として使用します。

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

## 定期closeのCLI実行（Cloud Run Job向け）

Cloud Run Job運用推奨（3分割）:

- `close-day`: command=`/app/ops`, args=`close --scope day --all-teams`
- `close-week`: command=`/app/ops`, args=`close --scope week --all-teams`
- `close-month`: command=`/app/ops`, args=`close --scope month --all-teams`

実行順序は `close-day` → `close-week` → `close-month` の直列実行を推奨します（同時実行しない）。
`close-month` は月跨ぎ週の集計を取りこぼさないため、毎月6日実行を推奨します。

`ops close` は catch-up モードで動作し、未処理期間を連続で補完します（例: day 実行時は未処理の全日を昨日まで処理）。
過去期間の判定対象タスクは `created_at` / `deleted_at` を使って対象時点で有効だったものを再現します。
`seed-monthly-dummy` は月次サマリーを直接作成せず、集計は `ops close` に委譲します。
いずれも終了コードで成否を返します。対象の一部で失敗した場合も他対象は継続し、最後に非0終了となります（監視しやすい設計）。
内部実装として、冪等キー管理は `close_executions` から `close_runs` / `task_evaluation_dedupes` に責務分離されています。

## Frontend (Cloudflare Workers)

- デプロイ: `cd frontend && npm run deploy`
- 設定: `frontend/wrangler.toml`

PWA対応:

- `frontend/public/manifest.webmanifest` を配信し、ホーム画面への追加に対応
- ホーム追加時のアプリ名は `KajiChalle`
- テーマ色・背景色は `#f6f4ef` を使用
- 更新トーストは「既存SW制御下で新SWが `waiting` になった場合」に表示
- 再インストール直後は更新対象がないため、更新トーストが表示されない場合あり

リアルタイム同期（SSE）:

- ログイン中クライアントは `GET /v1/events/stream` に接続し、同一team内の更新通知を受信します。
- 競合防止は `ETag + If-Match`、即時反映は `SSE` で役割分離しています。
- 更新通知を受けたクライアントは必要なデータを再取得し、PWA環境でも他メンバー操作を反映します。
- SSE通知の欠落や一時切断に備えて、フォーカス復帰/オンライン復帰時の再取得と低頻度ポーリングを併用します。
- 更新系APIは `If-Match` が必須です。未送信は `428 precondition_required`、不一致は `412 precondition_failed` を返します。

PWAアイコン再生成:

- 元画像: `frontend/public/app.png`（1024x1024）
- 実行: `cd frontend && npm run pwa:assets`
- 生成先: `frontend/public/icons/`, `frontend/public/favicon.ico`

必要な環境変数:

- `VITE_API_BASE_URL`: APIベースURL（推奨: `/api`）
- `API_ORIGIN`: Workerが転送するbackend APIのオリジン（例: `https://kaji-backend-xxxx.run.app`）

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

- Region: `asia-northeast1`
- Service: `kaji-backend`
- Deploy mode: `--allow-unauthenticated`（アプリ層で認証）

OIDC厳格運用（推奨）:

- `OIDC_STRICT_MODE=true` を設定すると、`OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URL` が未設定の場合にbackendは起動失敗します。
- `OIDC_STRICT_MODE=true` ではローカルモック認証分岐は無効化されます。

Cookieセッション認証:

- 認証は `HttpOnly` Cookie (`kaji_session`) で管理します（Bearer tokenは非対応）。
- backend は `FRONTEND_ORIGIN` を許可オリジンとして使用します。
- `COOKIE_SECURE=true` で `Secure` Cookie を強制します（ローカルHTTP開発時は `false`）。

初回リリース向け新規アカウント作成ガード:

- `SIGNUP_GUARD_ENABLED=true` で新規アカウント作成を許可メール制にします。
- `SIGNUP_ALLOWED_EMAILS` にカンマ区切りで許可メールを設定します（例: `me@example.com,wife@example.com`）。
- 既存ユーザーは allowlist から外れてもログイン可能です。
- `SIGNUP_GUARD_ENABLED=true` かつ `SIGNUP_ALLOWED_EMAILS` が空の場合、backend は起動失敗します（fail-fast）。

## 初回リリースの推奨設定（クローズド運用）

- backend:
  - `SIGNUP_GUARD_ENABLED=true`
  - `SIGNUP_ALLOWED_EMAILS=<あなたのGoogleメール>,<奥様のGoogleメール>`

緊急時に公開制限を解除する場合:

- backend 側: `SIGNUP_GUARD_ENABLED=false`

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
