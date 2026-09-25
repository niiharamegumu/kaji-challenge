# アーキテクチャ

現在の実装は `app/` 内のTanStack Start SPAと、同じWorkerのServer Functions・認証HTTP入口・scheduled入口で構成する。画面は既存のFeature-Based Architectureを維持する。

- `src/router.tsx` がRouterを構築し、`src/routes` は薄い画面入口。画面実装は `src/features`、全体組み立ては `src/app`。
- 家事・ペナルティ・集計・設定のURLは `/tasks`・`/penalties`・`/summary`・`/settings`。`_app` はURLに含めない共通layoutで、機能フォルダ名からURLの接頭辞を付けない。画面実装は対応する `features/tasks`・`penalties`・`summary`・`settings` に配置し、各featureでquery/mutationやフォーム状態を管理する。複数featureで使う削除確認モーダルは `shared/components` に置く。
- `src/contracts/operations.ts` はZod入力/出力の正本で、`models.ts` はそのschemaからDTOの型を導出する。feature adapterは `src/lib/api/operations.ts` からServer Functionsを呼ぶ。
- `src/server/transport` で認証、入力検証、HTTP/Cronとの接続、依存組み立てを行う。
- `src/server/application` は認可・業務手順・Repository/Delivery portを定義し、`domain` は純粋な業務規則を置く。React、Start、Better Auth、Drizzle、Cloudflare bindingをimportしない。
- `src/server/infrastructure` がportを実装する。D1の `DB` bindingを使い、リクエスト/Cronの処理単位でRepositoryを構築する。接続文字列・接続プールは持たない。
- 業務データはD1へ保存し、チーム単位のDurable ObjectはWebSocketの変更通知と接続一覧だけを扱う。revision・ETag・操作ID・書き込み再試行は持たない。
- browserからserver実装を直接importしない。例外は `serverClient.ts` から変換対象Server Functionへの入口と、契約schemaが利用する純粋な日付検証だけ。型importは許可する。
- `make architecture-check` はUIとTS serverの依存境界を検査する。

## Server Functions

`operations.functions.ts` は静的importできる `createServerFn` の入口。`validator` でZod検証し、handlerでsession/originを検証、Applicationでチーム認可を実施する。入力不正・業務エラーは型付き結果で返し、SQLや認証情報を返さない。入力と認可の検証後、用途別Repository操作で保存する。返却DTOも出力schemaで検証するが、既にcommitした保存は応答検証の失敗では取り消せない。結果はStartのシリアライズへ渡し、手動のJSON stringify/parseは行わない。

feature adapter → 共通client → Server Function → Application → Repositoryという構成は、Startのserver-only処理とUIの分離に従う。TanStack Queryがキャッシュ・再取得・mutationを管理する。単一のdiscriminated unionによるoperation入口はこのアプリの設計であり、Startの必須形式ではない。routeのbeforeLoadだけを認証境界にしない。

共通Server FunctionはPOST。読み取りoperationはD1を更新しない。期限切れ単発予定は表示時に除外し、日次ジョブで削除する。集計の保存は締め・過去の完了修正時だけ行う。Startのredirectを返さず既存のエラー処理を使うため、共通clientから静的importした関数を直接呼ぶ。`useServerFn` はredirect等をRouterと連携するときに検討する。Server Function応答はWorker入口でno-storeにする。

## UIの境界

- 他featureのcomponents/hooks/state/libを直接importせず、`features/<feature>/index.ts` の公開APIを使います。
- 共通UIは `shared/components`、共通query/stateは `shared/query` と `shared/state` に配置します。
- 追加・編集フォームは `shared/components/FormSheet.tsx` の共通シェルを使います。`FooterQuickAction` は追加ボタンとそのシェルの組み立てを担当し、featureに端末別のシェルを複製しません。
- `shared` は `features` に依存しません。画面はfeature adapterを通してServer Functionsを利用します。

### 操作のフィードバック

家事の完了・購入済みは、TanStack Queryの未完了mutationの入力を取得結果に重ねて即時表示する。保存済みキャッシュは成功応答で更新し、失敗時はそのmutationの表示だけが消える。他の操作やメンバーの完了を一括rollbackしない。日間・週1回の保存中の連打は抑止する。週複数回は連続タップを受け付け、increment/decrementを送り、D1内の件数条件で上限・下限を守る。追加・編集フォームはPromiseを返し、共通FormSheetとインライン編集は呼出元mutationの `isPending` / `isError` を表示に使う。別のref/stateへ保存状態を複製せず、保存中の入力・閉じる操作・重複送信を抑止する。失敗時は入力を保持し、再表示時にmutationをresetする。全体の保存中表示は `shared/components/MutationFeedback.tsx` が担当する。

API応答の実行時検証は共通clientの出力schemaで行う。feature hookで再検証したり、不正なDTOを一覧再取得で隠したりしない。保存応答のDTOを一覧に反映し、派生データの再取得はバックグラウンドで行う。家事完了の一覧同期は最後のpending mutationが終了するときにまとめる。楽観表示をDB保存済みの証拠として扱わず、再読込の検証では保存応答も待つ。

`lib/api/serverClient.ts` は待ち行列を持たずServer Functionsへ送信する。日間・週1回はcomplete/incomplete、週複数回はincrement/decrementという意図を送る。mutationは `networkMode: "always"` / `retry: false` とし、オフラインでも一度試みて失敗を返す。更新を自動再送しない。ログアウト・所属変更ではAbortControllerで古い通信を打ち切り、Queryキャッシュと接続を破棄する。

## D1の更新

認証・業務・Pushは `infrastructure/database.ts` で作るDrizzle D1 handleを使用する。業務テーブルは `schema.ts`、認証は `auth-schema.ts`。通常のCRUDはquery builder、集計・条件付きINSERTにはパラメーター化した `sql` を使用する。

D1は対話的transactionを提供しない。複合操作は `repository.ts` の用途別コマンドが `db.batch()` で原子的に実行する。チーム移動・初期登録・担当解除・owner引継ぎは1つのbatch。完了回数はDBのCOUNTを条件に更新し、締め・過去の修正は `summary-statements.ts` の集計queryを同じbatchへ含める。batch内のSQL失敗は全体をrollbackする。認可や回数など変化する条件もSQLで検査し、外部通信はbatchへ含めない。read-modify-writeをJavaScriptで疑似transactionにしない。

同じ項目の更新はDBが後に適用したものを採用する。主キー・外部キー・日次完了の一意制約・close_runsは保持するが、team/global revision、操作ID、通知連番、再試行用の台帳はない。WebSocket通知は保存の原子性や必達性を保証しない。応答が失われた更新は再取得して結果を確認し、必要なら手動で直す。

Better Authのnickname/colorHexは追加項目（input:false）としてアプリの認可済みAPIから更新する。初期チーム作成は所属の不在をSQLで確認し、同時初回ログインでも1チームにする。最大5セッションはSQL trigger、Pushの配信済み抑止は既存の専用記録で担保する。D1 read replicationは無効で、すべてprimaryへ読み書きする。

## リアルタイム同期と接続メンバー

`server-entry.ts` の `/api/realtime` は `realtime.server.ts` でOrigin・Better Authセッション・所属を検証する。チームとユーザーはブラウザーから受け取らず、サーバーが特定して `TEAM_REALTIME.getByName(teamId)` に接続する。HTTP101は共通ヘッダー処理で作り直さない。Service Workerの `/api/` 除外にはこの経路も含む。

`infrastructure/team-realtime.ts` のTeamRealtimeは公式WebSocket Hibernation APIを使い、認証済みuserId/sessionId/teamIdをattachmentに保存する。復帰時は `getWebSockets()` と `deserializeAttachment()` から一覧を作る。接続一覧・業務データをDOのSQLに保存しない。通知時にセッション期限・失効・所属を検査し、不正な接続を閉じる。D1への認可照会と配信は公式`blockConcurrencyWhile`内で実行し、その間の入退室による未検証接続への配信・presenceの順序逆転を防ぐ。この範囲に業務データの更新は含めない。認可照会失敗時はログを残して接続を閉じ、再接続へ戻す。複数タブはuserIdでまとめ、最後の接続を閉じたときにpresenceの接続中一覧から外す。

メッセージは `contracts/realtime.ts` のpresence（userIdsの全置換）とteam-changed（再取得通知）。Server FunctionsとジョブはD1保存後に通知し、失敗は構造化ログへ記録する。通知失敗を保存失敗にしない。

`useTeamRealtime.ts` は共通レイアウトに1接続を持ち、ページ移動では再接続しない。接続・復帰・team-changedで関連Queryを再取得する。mutation中の通知は終了までまとめ、楽観表示を上書きしない。切断時は接続中ユーザーIDの一覧を空にして再接続状態へ切り替え、指数バックオフで接続だけを再試行する。業務更新は再送しない。

ヘッダーのConnectedMembersは自分を含むチームメンバーを接続の有無にかかわらず表示する。接続中は通常色、未接続は彩度・不透明度を下げたグレー寄りの表示とする。自分の通信が切れた場合もアイコンは残し、全員を薄い色の「接続確認中」として古いpresenceを表示に使わない。スマートフォンは左にチーム名と日付、右上にメンバーのアイコンを置き、PCでは横一列にする。アイコンは先頭2人まで表示し、残りは「+人数」に集約してタップで全員の名前・状態・アイコンを確認できる。名前と接続状態はタップ、ホバー、キーボードフォーカスで確認でき、Escapeまたはフォーカスが外れると閉じる。閲覧ページや操作中状態は収集しない。他メンバーの通信断・強制終了ではサーバーの切断検知まで接続中表示が残る。

公式資料: [DOの同時実行制御](https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile)、[DOクラス宣言](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)、[WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)、[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)。

## SQLと運用

`app/migrations/` がSQLの正本。新規DBには全migrationを番号順に適用する。`0002_unify_users.sql` はユーザーをBetter Authへ統合し、`0003_iso_timestamps.sql` は認証・レート制限・Pushの日時をUTC ISO文字列へ統一する。`0004_remove_revisions.sql` はteams.state_revisionとapp_revisionだけを削除する。既存D1のプロフィール・外部キー・履歴を保持する。Drizzle定義と適用済みDBのテーブル・列・主キー・外部キーは統合テストで照合する。テーブルの責務は [database.md](database.md) に記載する。旧DBの履歴やデータ移行は持たない。以降のschema変更は新しい番号のSQLとして追加し、適用済みファイルを編集しない。

`app/alchemy.run.ts` と `app/infra/` がWorker・D1・TeamRealtimeのDO binding・ドメイン・Secrets・Cronを管理する。Alchemyの公開DurableObject APIを使い、既存Workerからクラスをexportする。ローカルwrangler.jsoncには同じbindingと、公式の`exports`によるSQLite DOクラス宣言を持つ（D1のSQL migrationとは別）。SQLite DOなのでWorkers Freeでも利用できる（利用枠内）。配備時のSQL適用はAlchemyが管理する。ローカルはWranglerで同じSQLを適用する。環境はlocalとproductionだけとし、WranglerのローカルDBと本番D1を共有しない。本番のIaCはproduction以外のstageを拒否する。

本番配備は `.github/workflows/deploy-production.yml` がmain更新時にproduction Environmentの設定でplan/deployを実行する。CIはPR時に実行し、CDでは再実行しない。mainの保護ルールでPRと `cloudflare-quality` の成功を必須にする。SecretsはCIへ渡さず、配備stepに限定する。配備を直列化し、公開先のhealthとcommit SHAを検証する。

### ビルドと配備の分担

TanStack Start/Cloudflare公式の `@cloudflare/vite-plugin` で `vp dev` / `vp build` / `vp preview` を実行する。独自Worker入口 `src/server-entry.ts` は維持し、build出力は `dist/server/index.js` と `dist/client`。SPA shellはStart、Service WorkerとprecacheはVite PWA/Workboxが生成する。現行web-push依存にはNode組込moduleへのrequireが残るため、従来のcreateRequire bannerは維持する。Cloudflare pluginがplatformをneutralにするため、単にNode出力を指定しても代替できない。依存更新で不要になった時点で撤去する。

Alchemyは `Cloudflare.Worker("Application", { bundle: false, ... })` でbuild済み生成物を配備する。`Website.Vite` とAlchemy独自Vite pluginは使用しない。stack名・Application/Databaseの論理ID・本番bindingは維持する。ローカルはwrangler.jsonc、本番のリソースと実行時設定はalchemy.run.ts/infra/config.tsが管理する。build出力のローカル用DB IDやvarsを本番へコピーしない。

CDは本番Secretsを渡さずbuildし、その後のstepでAlchemy bootstrap → plan → deploy → health確認を実行する。CIの再実行はしない。build出力の入口・assetsディレクトリを変えた場合はIaCも更新し、test:localで一致を検証する。

公式資料: [CloudflareのTanStack Start構成](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)、[Alchemyのビルド済みWorker配備](https://alchemy.run/providers/cloudflare/workers/worker/#configuration)。
