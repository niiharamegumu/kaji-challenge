# KajiChalle

家事をチームで分担し、毎日・毎週の達成状況を記録するPWAです。買い物リスト、カレンダーの予定、月次ペナルティ集計、Push通知をまとめて利用できます。

## 構成

| 領域 | 使用技術 |
| --- | --- |
| 画面 | React・Tailwind CSS・TanStack Router / Query・Jotai |
| アプリ | TanStack Start（SPA + Server Functions） |
| 実行環境 | Cloudflare Workers |
| データベース | Cloudflare D1（SQLite） |
| 認証 | Better Auth・Google OAuth・Drizzle D1 adapter |
| DBアクセス | Drizzle ORM（認証・業務・Push配信記録） |
| 定期処理 | Workers Cron Triggers |
| インフラ | Alchemy（Worker・D1・SQL適用・ドメイン・Secrets・Cron） |
| 開発 | mise（Node.js 24・Bun）・Vite+・Vitest・Playwright |

ブラウザーはServer Functions経由で業務処理を呼び出します。ユーザー情報はBetter Authの `auth_user` に一元化し、チーム・家事などの業務データも同じD1に保存します。外部PostgreSQLやDBサーバー用コンテナは不要です。全員、新しいGoogleログインからユーザーと初期チームを作成します。

## 日付・タイムゾーン

業務上の「今日」・月・週・締め・通知と日時表示は日本時間（`Asia/Tokyo` / UTC+09:00）を基準にします。端末のタイムゾーンが日本以外でも同じ日付を扱います。

- Worker・D1・Docker・GitHubに `TZ` を追加する設定は不要です。アプリが明示的に日本時間を使用します。`ja-JP` は表示言語であり、タイムゾーン指定とは別です。
- 認証・業務・Push・レート制限の日時はすべてUTCのISO 8601文字列（例: `2026-09-23T06:56:17.439Z`）で保存します。D1 ExplorerでUTCの値が見えるのは正常です。対象日・対象月は `YYYY-MM-DD` / `YYYY-MM` の日付文字列です。
- カレンダーの予定は日付のみで管理します。FullCalendar内部の日付計算をUTCに固定し、「今日」は日本時間の日付を渡すことで端末時差によるずれを防ぎます。
- CronはUTCで指定済みです。日次締め00:05 JST、週次締め月曜00:10 JST、通知21:00／土曜19:00／日曜10:00 JSTに対応します。初回は `JOBS_ENABLED=true` にして再配備し、実行を確認してください。

## ローカル起動

Docker Compose、またはmiseで管理したホストのNode.js・Bunを使用します。

### ホストのツール準備（mise）

Node.js・Bunのバージョンはリポジトリ直下の [mise.toml](mise.toml) で管理します。macOSでは次の手順で準備できます。

```sh
# miseが未インストールの場合
brew install mise

# リポジトリ直下で実行
mise trust
mise install
mise exec -- node --version
mise exec -- bun --version
```

普段のターミナルで `node` / `bun` を直接使うには、`~/.zshrc` に以下を一度だけ追加し、ターミナルを開き直してください。既に設定済みなら追加不要です。

```sh
eval "$(mise activate zsh)"
```

シェル設定を変更しない場合は、各コマンドの先頭に `mise exec --` を付けます。例えば `cd app && mise exec -- bun run typecheck` です。詳細は [miseのセットアップ](https://mise.jdx.dev/getting-started) を参照してください。

現在の設定はNode.js `24`・Bun `latest` です。動作確認時はNode.js `24.21.0`・Bun `1.4.2` が選択されました。CIはNode.js 24・Bun 1.4.2、DockerはNode.js 24.14.0・Bun 1.4.2を使用し、miseの設定とは独立しています。Bunを更新する際は、`app/package.json` の `packageManager`・`app/Dockerfile.dev`・`.github/workflows/ci.yml`・`.github/workflows/deploy-production.yml` のバージョンも揃えて検証してください。

### アプリの設定と起動

1. `cp app/.dev.vars.example app/.dev.vars` を実行し、後述の認証設定を記入します。
2. GoogleのOAuthクライアント（種類: ウェブアプリケーション）に以下を登録します。
   - JavaScript生成元: `http://localhost:5174`
   - リダイレクトURI: `http://localhost:5174/api/auth/callback/google`
   - 同意画面がテスト中の場合は、ログインするGoogleアカウントをテストユーザーに追加します。
3. リポジトリ直下で `make dev` を実行します。バックグラウンド起動は `make up`、停止は `make down` です。
4. `http://localhost:5174` を開き、Googleでログインします。

Composeのサービス名は `app` です。起動時に依存関係とローカルD1のSQLを適用します。DBは `app/.wrangler/` に保存され、コンテナを再作成しても残ります。設定変更後は `docker compose restart app` を実行します。旧サービスが残っている場合は `docker compose down --remove-orphans` で停止してから起動してください。

ホストで動かす場合:

```sh
cd app
mise exec -- bun install --frozen-lockfile
mise exec -- bun run db:migrate
mise exec -- bun run dev
```

Composeとホストの開発サーバーは同時起動しないでください。ローカル用の `wrangler.jsonc` のDB IDはローカル保存先の識別子で、本番のD1 IDに差し替える必要はありません。

Git hookを有効にする場合、依存関係をインストール後に `cd app && mise exec -- bun x --no-install vp hooks enable` を実行します。`vp` のグローバルインストールは不要です。pre-commitは `make lint` を実行します。

ローカルD1は [Local Explorer](http://localhost:5174/cdn-cgi/local/explorer) で閲覧できます。app起動中に、macOSのホストで `cd app && mise exec -- bun run db:studio` を実行するとブラウザーで開きます。

## 設定値

開発時の秘密値は `app/.dev.vars`、公開設定は `app/wrangler.jsonc` の `vars` に置きます。配備時はGitHub Environment `production` のSecrets/VariablesをAlchemyへ渡します。例外的な手動配備では秘密管理先から実行シェルの環境変数へ読み込みます。秘密値と実DBファイルはGit管理対象外です。ブラウザーへ渡す `VITE_*` に秘密値を置かないでください。

| 設定 | 内容 |
| --- | --- |
| `BETTER_AUTH_SECRET` | 32文字以上のランダム値。`openssl rand -hex 32` などで生成。セッション署名とOAuthトークン暗号化に使うため、環境ごとに固定して安全に保管 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 環境ごとのGoogle OAuthクライアント |
| `SIGNUP_ALLOWED_EMAILS` | 新規登録を許可するメールのカンマ区切り。空欄不可。登録済みユーザーの再ログインには適用しない |
| `APP_ORIGIN` | 開発: `http://localhost:5174`。配備: パス・ポートを含まないHTTPS origin |
| `APP_RELEASE` | リリース識別子（commit SHAなど） |
| `JOBS_ENABLED` | 定期処理の有効化。初回は `false`、動作確認後に `true` |
| `MAINTENANCE_MODE` | `true` で認証・業務リクエストを停止。Cronも配備設定から外れる |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Push用鍵ペア。`cd app && bunx --no-install web-push generate-vapid-keys` で生成。公開鍵はvars、秘密鍵は.dev.varsに設定 |
| `VAPID_SUBJECT` | 運用担当の `mailto:` アドレスまたはHTTPS URL |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | Alchemy配備用。Workerの実行時設定には含めない |

新規登録はlocal・productionとも許可リストが必須で、解除用フラグはありません。空欄・未設定ならログイン処理を503で停止します。Googleで確認済みのメールがリストと一致する場合のみ登録できます（大文字小文字とリスト前後の空白は正規化）。ログイン画面は公開されますが、業務データの利用には認証が必要です。登録済みユーザーを許可リストから外しても再ログインは可能です。これは新規登録の制限であり、既存ユーザーの利用停止機能ではありません。

ローカルの定期処理は既定で無効です。Pushを使わないローカル開発ではVAPID鍵を空欄にできます。配備環境では設定してください。認証CookieはHttpOnly・SameSite=Lax、本番HTTPSではSecureです。セッションはD1保存・30日・最大5件で、Cookieキャッシュは使用しません。

## 検証コマンド

```sh
cd app
bun run typecheck
bun run lint:all
bun run test --run
bun run test:server --run
bunx --no-install playwright install chromium
bun run test:local
```

`test:local` は一時ディレクトリへソースをコピーし、テスト専用の認証設定と使い捨てD1で、build・型・lint・UI・DB・ブラウザー・開発サーバーの検証を行います。普段の `.dev.vars` と `.wrangler` は使用しません。5194/5195ポートを空けて実行してください。結果は `app/test-results/` に保存します。Googleとの実OAuthとiPhone実機へのPushは別途確認します。

## Cloudflareへの配備

環境は **localとproductionのみ** です。localはWranglerのD1（`kaji-local`）、productionはAlchemy管理のD1（`kaji-production`）を使います。

[Deploy production](.github/workflows/deploy-production.yml) が `main` へのpushで実行されます。**設定検証 → Alchemy状態保存先の確保 → plan → deploy（build・未適用SQL・Worker更新）→ 公開先health/release確認**を自動化しています。CIはPR時に実行し、CDでは再実行しません。CIへ本番Secretsを渡しません。`APP_RELEASE` は対象commit SHAを自動設定します。

### 初回だけ行うこと

1. **Cloudflareを準備。** 対象アカウント、Activeなドメインのzone、API tokenを用意します。まずWorkers Freeで開始できます。
   - **アカウントの管理 → アカウント API トークン → トークンを作成 → 最初から作成**で、配備専用tokenを作ります。権限ポリシーは2つに分けます。アカウント全体にはWorkers Admin（初回Worker作成用）・D1 Edit・Secrets Store Edit、指定ドメインには公開先zoneのZone Read・Workers Routes Editを設定します。`Account Settings Read` はこの構成の必須権限として指定しません。対象ドメインを含むアカウントだけを使い、実アカウントの権限はbootstrapと初回deployで確認してください（[Workers権限](https://developers.cloudflare.com/workers/authorization/workers/)・[Secrets Store権限](https://developers.cloudflare.com/secrets-store/access-control/)）。
   - Alchemyの状態保存先はSQLite型Durable Objectを使用し、Freeで利用できます。FreeではWorkerのHTTP・CronともCPU時間10ms、D1クエリは1回の呼び出しにつき50件、Cronはアカウント全体で5本までです。このアプリは有効化時に5本使うため、他のCronがある場合やCPU・D1上限に達した場合はPaidへの変更を検討してください（[Workers制限](https://developers.cloudflare.com/workers/platform/limits/)・[D1制限](https://developers.cloudflare.com/d1/platform/limits/)）。
2. **Google OAuthを準備。** 本番用のウェブアプリケーションクライアントを作成し、生成元 `https://<本番ホスト>`、redirect URI `https://<本番ホスト>/api/auth/callback/google` を登録します。同意画面の公開範囲も確認します。
3. **本番の鍵を作成。** `BETTER_AUTH_SECRET` は `openssl rand -hex 32`、VAPID鍵は `app/` で `mise exec -- bun x --no-install web-push generate-vapid-keys` で生成します。安全に保管し、毎回生成し直しません。
4. **GitHub Environmentを作成。** リポジトリの Settings → Environments → New environment で `production` を作ります。Deployment branches/tagsを選択制限し、branch `main` だけを許可します。完全自動にする場合はRequired reviewersを設定しません。設定する場合、CDはその承認待ちになります。Settings → Rules/Branchesでは、mainへの変更にPRと `cloudflare-quality` の成功を必須にしてください。CDはCIを再確認しないため、直接pushやルールのバイパスでは未検証コードも配備対象になります。
5. **EnvironmentのSecrets/Variablesを登録。** 下表の名前で追加します。ローカルの本番用envファイルは不要です。

| 種別 | 名前 | 値・用途 |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | 配備・状態保存先への操作権限を持つtoken |
| Secret | `BETTER_AUTH_SECRET` | 本番の固定キー。32文字以上 |
| Secret | `GOOGLE_CLIENT_SECRET` | 本番OAuth client secret |
| Secret | `SIGNUP_ALLOWED_EMAILS` | 許可メールをカンマ区切り。空欄不可 |
| Secret | `VAPID_PRIVATE_KEY` | 本番Push秘密鍵 |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | 本番のアカウントID |
| Variable | `GOOGLE_CLIENT_ID` | 本番OAuth client ID |
| Variable | `APP_ORIGIN` | 本番HTTPS origin。パス・ポートなし |
| Variable | `VAPID_PUBLIC_KEY` | 本番Push公開鍵 |
| Variable | `VAPID_SUBJECT` | `mailto:` 連絡先またはHTTPS URL |
| Variable | `JOBS_ENABLED` | 初回は `false`、初回動作確認後 `true` |
| Variable | `MAINTENANCE_MODE` | 通常 `false`、停止時のみ `true` |

`APP_RELEASE` の登録は不要です。Cloudflare tokenには、CDが状態保存先の資格情報を取得するためのSecrets Store Editも必要です。権限不足を解消するために全権限tokenへ置き換えるのではなく、失敗したAPIとscopeを確認します。

6. **初回CDを実行。** 設定を済ませ、CIが成功したPRを `main` へマージするか、Actions → Deploy production → Run workflow → branch `main` を選びます。CDは初回にAlchemyの状態保存用Worker/DO/Secrets Storeを作り、その後アプリ本体と業務D1を配備します。以降は既存の状態保存先を再利用します。ローカルでのbootstrapや `.alchemy` のアップロードは不要です（[AlchemyのCI状態管理](https://alchemy.run/state-store/)）。初回はジョブ無効で配備されます。下記のブラウザー確認後、`JOBS_ENABLED=true` にして同じworkflowを手動実行し、5本のCronを有効にします。

### 毎回のリリース

1. PRのCI成功を確認して `main` へマージします。CIが失敗しているPRはマージしません。
2. Actionsの **Deploy production** を開き、`deploy` の成功を確認します。planはログに出力され、その後deployを自動実行します。**plan確認の手動停止はありません。** SQLやIaCの意図しない変更はPRで確認してください。
3. 公開先 `/health` の `status: ok` と `release: 対象SHA` はCDが確認します。伝播待ちのため最大12回・各5秒タイムアウトで再試行します。
4. ブラウザーでログイン、家事・買い物・予定の保存と再読込、ログアウトを確認します。認証/PWA/Push変更時は新規登録許可・拒否、PWA更新、iPhone実機Pushも確認します。これはCDのhealth確認では代替しません。
5. CloudflareのWorkerログでエラー・締め・通知結果を確認します。通常の更新では鍵の再作成・手動bootstrap・ジョブ無効化は不要です。

同時に配備しないようworkflow全体を直列化し、開始済みの処理は新しいpushで中断しません。待機中の古いrunは新しいrunに置き換わる場合があります。配備job開始時、mainに新しいcommitがあるrunは配備をスキップします。手動再実行も最新mainを対象にしてください。

### 設定変更・障害時

- **設定/Secret更新**：GitHub Environment `production` の値を変更し、ActionsからmainのDeploy productionを手動実行します。設定変更だけでは自動起動しません。
- **schema変更**：新しい番号（現在は `app/migrations/0004_*.sql` 以降）のSQLを追加し、CIで検証してからマージ。Alchemyが未適用SQLを適用します。適用済みSQLを編集せず、本番へWranglerで重ねて適用しません。`db:migrate` はローカル専用です。 既存DBへの `0003_iso_timestamps.sql` 適用は旧コードと日時形式が非互換のため、この変更のマージ前に現行mainをメンテナンス状態で配備し、SQLと新Workerの配備完了後に解除します。詳細は [日時の保存形式](docs/database.md#日時の保存形式) を参照してください。
- **停止が必要な作業**：Environmentの `MAINTENANCE_MODE=true` に変更してCD実行。受付停止とCron解除を確認して作業し、falseへ戻してCD実行・復帰確認します。
- **配備失敗**：エラーログを確認して修正後、最新mainで再実行。health失敗では自動rollbackしません。SQL適用後にWorker更新だけ失敗する場合もあるため、古いコードへ戻す前にDB互換性を確認します。復元は別の操作です。
- **手動配備が必要な場合**：本番設定を秘密管理先から実行シェルの環境変数へ読み込み、`app/` で `mise exec -- bun run infra:plan --stage production` → `mise exec -- bun run deploy --stage production`。CDと同時実行せず、`APP_RELEASE` を対象コードに合わせて確認します。普段はGitHub Environmentを正としてください。

実際のCloudflare/GitHub設定・配備は初回作業が必要です。ローカル検証はアカウント権限・Google実OAuth・本番D1の復元/性能・実機Pushを代替しません。業務API専用のレート制限と運用監視も配備時に確認します。

日次締め00:05 JST、週次締め月曜00:10 JST、通知は毎日21:00・土曜19:00・日曜10:00 JST。正本は `app/src/server/application/jobs.ts` です。

## コードを読む順番

1. `app/src/routes/`・`app/src/features/`: 画面と操作。
2. `app/src/contracts/operations.ts`・`app/src/lib/api/`: 入出力の契約と通信。
3. `app/src/server/transport/` → `application/` → `domain/`: 認証・認可・業務手順と規則。
4. `app/src/server/infrastructure/`: D1、Better Auth、Pushの実装。`schema.ts` / `auth-schema.ts` がDrizzleのテーブル定義、`repository.ts` が型付きクエリ。業務更新は `unit-of-work.ts` のDrizzle batchでまとめる。
5. `app/migrations/`・`app/alchemy.run.ts`・`app/infra/config.ts`: SQLと配備構成。

テーブルの責務は [database](docs/database.md)、詳しい境界は [architecture](docs/architecture.md)、検証方針は [testing](docs/testing.md) を参照してください。個人用資料・作業記録はGit管理外の `local-notes/` に保存します。

画面の実装は `app/src/features/tasks`（家事）・`penalties`（ペナルティ）・`summary`（集計）・`settings`（設定）に分けています。各Pageを起点にhooksやapiを読むと取得・更新処理を追えます。
