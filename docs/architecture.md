# アーキテクチャ

現在の実装は `app/` 内のTanStack Start SPAと、同じWorkerのServer Functions・認証HTTP入口・scheduled入口で構成する。画面は既存のFeature-Based Architectureを維持する。

- `src/router.tsx` がRouterを構築し、`src/routes` は薄い画面入口。画面実装は `src/features`、全体組み立ては `src/app`。
- 家事・ペナルティ・集計・設定のURLは `/tasks`・`/penalties`・`/summary`・`/settings`。`_app` はURLに含めない共通layoutで、機能フォルダ名からURLの接頭辞を付けない。画面実装は対応する `features/tasks`・`penalties`・`summary`・`settings` に配置し、各featureでquery/mutationやフォーム状態を管理する。複数featureで使う削除確認モーダルは `shared/components` に置く。
- `src/contracts/operations.ts` はZod入力/出力の正本で、`models.ts` はそのschemaからDTOの型を導出する。feature adapterは `src/lib/api/operations.ts` からServer Functionsを呼ぶ。
- `src/server/transport` で認証、入力検証、HTTP/Cronとの接続、依存組み立てを行う。
- `src/server/application` は認可・業務手順・Repository/Delivery portを定義し、`domain` は純粋な業務規則を置く。React、Start、Better Auth、Drizzle、Cloudflare bindingをimportしない。
- `src/server/infrastructure` がportを実装する。D1の `DB` bindingを使い、リクエスト/Cronの処理単位でRepositoryを構築する。接続文字列・接続プールは持たない。
- team IDと文字列revisionを検証し、業務更新とrevision更新をD1のatomic batchでcommitする。下記の競合制御をすべての業務書き込みに適用する。
- browserからserver実装を直接importしない。例外は `serverClient.ts` から変換対象Server Functionへの入口と、契約schemaが利用する純粋な日付検証だけ。型importは許可する。
- `make architecture-check` はUIとTS serverの依存境界を検査する。

## Server Functions

`operations.functions.ts` は静的importできる `createServerFn` の入口。`validator` でZod検証し、handlerでsession/originを検証、Applicationでチーム認可を実施する。入力不正・業務エラーは型付き結果で返し、SQLや認証情報を返さない。出力schemaをtransaction内で検証してからcommitする。結果はStartのシリアライズへ渡し、手動のJSON stringify/parseは行わない。

feature adapter → 共通client → Server Function → Application → Repositoryという構成は、Startのserver-only処理とUIの分離に従う。TanStack Queryがキャッシュ・再取得・mutationを管理する。単一のdiscriminated unionによるoperation入口はこのアプリの設計であり、Startの必須形式ではない。routeのbeforeLoadだけを認証境界にしない。

取得処理にも期限切れ予定の整理・集計更新が含まれるため、現在はすべてPOST。純粋な読み取りに分離するまではGETへ変更しない。Startのredirectを返さず既存のエラー処理を使うため、共通clientから静的importした関数を直接呼ぶ。`useServerFn` はredirect等をRouterと連携するときに検討する。Server Function応答はWorker入口でno-storeにする。

## UIの境界

- 他featureのcomponents/hooks/state/libを直接importせず、`features/<feature>/index.ts` の公開APIを使います。
- 共通UIは `shared/components`、共通query/stateは `shared/query` と `shared/state` に配置します。
- 追加・編集フォームは `shared/components/FormSheet.tsx` の共通シェルを使います。`FooterQuickAction` は追加ボタンとそのシェルの組み立てを担当し、featureに端末別のシェルを複製しません。
- `shared` は `features` に依存しません。画面はfeature adapterを通してServer Functionsを利用します。

## D1の更新と競合制御

認証・業務・Push配信記録は `infrastructure/database.ts` で作る同じDrizzle D1 handleを使用する。業務テーブルは `schema.ts`、認証テーブルは `auth-schema.ts` に定義し、Repositoryは型付きquery builderで読み書きする。複雑な再帰集計やSQLiteの日付・window関数はDrizzleの `sql` を使用する。SQL結果の列順による変換は行わない。

D1では対話的なSQL transactionを開始できないため、`infrastructure/unit-of-work.ts` がリクエスト内の変更行とDrizzleの更新queryを保持する。commit前の読み取りは `db.with()` のCTEで変更行を重ね、join・集計にも未確定の変更を反映する。schemaのcodecでDate/booleanをDB値へ変換し、読み取りではDrizzleが復元する。認可・業務検証・出力schema検証に成功した場合だけ、Drizzleの `db.batch()` でまとめて適用する。`db.transaction()` へ置換しない。

batchの先頭で `app_revision` の比較・更新を行う。他の業務処理が先にcommitした場合は制約違反でbatch全体を取り消し、最大3回まで読み取りから再実行する。業務SQLの制約違反も全体をrollbackする。チームrevisionはTEXT・BigIntで扱い、クライアントに丸め誤差のない文字列を返す。

これは全チームで共通の世代番号を使う楽観的な競合制御である。同時更新が増えると再試行が増えるため、高負荷時は再試行・DB処理時間を確認する。業務データの書き込みをRepository以外から行うと、この制御を迂回する。transaction callback内で外部送信など再実行できない副作用を起こさない。

認証テーブルはBetter Auth/Drizzle D1 adapterで扱う。ユーザー情報は `auth_user` のみを正とする。nickname/colorHexはBetter Authの追加項目（input:false）で、認可・revision検証付きの業務APIからのみ更新する。初期チーム・所属の作成は冪等な業務transactionで実行し、失敗後のログインで再実行できる。最大5セッションはSQL triggerで制限する。通知の送信枠はDrizzleのinsert-select/onConflictDoUpdateで取得し、配信成功を別のupdateで記録する。ネットワーク送信を業務batchに含めない。

D1のread replicationは無効。すべてprimaryへ読み書きし、リクエストをまたぐDB結果キャッシュを置かない。

## SQLと運用

`app/migrations/` がSQLの正本。新規DBには全migrationを番号順に適用する。`0002_unify_users.sql` はユーザーをBetter Authへ統合し、`0003_iso_timestamps.sql` は認証・レート制限・Pushの日時をUTC ISO文字列へ統一する。既存D1のプロフィール・外部キー・履歴を保持する。Drizzle定義と適用済みDBのテーブル・列・主キー・外部キーは統合テストで照合する。テーブルの責務は [database.md](database.md) に記載する。旧DBの履歴やデータ移行は持たない。以降のschema変更は新しい番号のSQLとして追加し、適用済みファイルを編集しない。

`app/alchemy.run.ts` と `app/infra/` がWorker・D1・ドメイン・Secrets・Cronを管理する。配備時のSQL適用はAlchemyが管理する。ローカルはWranglerで同じSQLを適用する。環境はlocalとproductionだけとし、WranglerのローカルDBと本番D1を共有しない。本番のIaCはproduction以外のstageを拒否する。

本番配備は `.github/workflows/deploy-production.yml` がmain更新時にproduction Environmentの設定でplan/deployを実行する。CIはPR時に実行し、CDでは再実行しない。mainの保護ルールでPRと `cloudflare-quality` の成功を必須にする。SecretsはCIへ渡さず、配備stepに限定する。配備を直列化し、公開先のhealthとcommit SHAを検証する。

### ビルドと配備の分担

TanStack Start/Cloudflare公式の `@cloudflare/vite-plugin` で `vp dev` / `vp build` / `vp preview` を実行する。独自Worker入口 `src/server-entry.ts` は維持し、build出力は `dist/server/index.js` と `dist/client`。SPA shellはStart、Service WorkerとprecacheはVite PWA/Workboxが生成する。現行web-push依存にはNode組込moduleへのrequireが残るため、従来のcreateRequire bannerは維持する。Cloudflare pluginがplatformをneutralにするため、単にNode出力を指定しても代替できない。依存更新で不要になった時点で撤去する。

Alchemyは `Cloudflare.Worker("Application", { bundle: false, ... })` でbuild済み生成物を配備する。`Website.Vite` とAlchemy独自Vite pluginは使用しない。stack名・Application/Databaseの論理ID・本番bindingは維持する。ローカルはwrangler.jsonc、本番のリソースと実行時設定はalchemy.run.ts/infra/config.tsが管理する。build出力のローカル用DB IDやvarsを本番へコピーしない。

CDは本番Secretsを渡さずbuildし、その後のstepでAlchemy bootstrap → plan → deploy → health確認を実行する。CIの再実行はしない。build出力の入口・assetsディレクトリを変えた場合はIaCも更新し、test:localで一致を検証する。

公式資料: [CloudflareのTanStack Start構成](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)、[Alchemyのビルド済みWorker配備](https://alchemy.run/providers/cloudflare/workers/worker/#configuration)。
