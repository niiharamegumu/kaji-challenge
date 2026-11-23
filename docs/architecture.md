# アーキテクチャ

## 共有ページ

チーム共通の文書は `features/shared-pages` と専用D1テーブルで管理する。保存形式・認可・期限付き編集権・ページ固有の版比較・TeamRealtime通知・ライセンスは [shared-pages.md](shared-pages.md) を参照する。家事の実績・得点・月次集計へ接続しない。

## 既存アプリの構成

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

境界検査はTypeScriptの構文木からimport・再export・動的importを読み取り、`.ts`と`.tsx`を区別する。他featureの`api`・`model`・`utils`を含む内部ファイルへの参照も禁止し、feature直下の`index.ts`だけを公開入口とする。複数featureが利用する日付表示は`shared/utils/dates.ts`に置き、`Intl.DateTimeFormat`を行ごとに作らず共有する。

## Server Functions

入口と全業務SQLの認可条件、Cron/初回所属/本人操作の区別、テスト対応表は [authorization.md](authorization.md) を参照する。通常セッションは検証済みuserId/sessionIdをRepositoryへ引き継ぎ、SQLでも失効・現在所属・対象チームを照合する。

`operations.functions.ts` は静的importできる `createServerFn` の入口。`validator` でZod検証し、handlerでsession/originを検証、Applicationでチーム認可を実施する。入力不正・業務エラーは型付き結果で返し、SQLや認証情報を返さない。入力と認可の検証後、用途別Repository操作で保存する。返却DTOも出力schemaで検証するが、既にcommitした保存は応答検証の失敗では取り消せない。結果はStartのシリアライズへ渡し、手動のJSON stringify/parseは行わない。

feature adapter → 共通client → Server Function → Application → Repositoryという構成は、Startのserver-only処理とUIの分離に従う。TanStack Queryがキャッシュ・再取得・mutationを管理する。単一のdiscriminated unionによるoperation入口はこのアプリの設計であり、Startの必須形式ではない。routeのbeforeLoadだけを認証境界にしない。

共通Server FunctionはPOST。読み取りoperationはD1を更新しない。予定の発生日取得では、既存のチーム/開始日indexを使い、対象期間に重ならない定義と期限切れ単発予定をD1で除外してから発生日を展開する。期限切れ単発予定は表示時に除外し、日次ジョブで削除する。集計の保存は締め・過去の完了修正時だけ行う。Startのredirectを返さず既存のエラー処理を使うため、共通clientから静的importした関数を直接呼ぶ。`useServerFn` はredirect等をRouterと連携するときに検討する。Server Function応答はWorker入口でno-storeにする。

認証HTTPとServer Functionsに渡す本文は、frameworkのJSON/form解析前に実ストリームのバイト数を数え、1 MiB超過で413を返す。Content-Lengthの欠落や過少申告にも同じ上限を適用する。予定の発生日取得は開始日から終了日まで両端を含め366日以内に制限し、契約とApplicationの両方で、DB取得・繰り返し展開・今日への期間補正より前に検査する。

日付計算は年0001〜9999の4桁形式を対象とし、加減算が範囲外になる場合は400で拒否する。月次集計・締めは翌月境界を必要とするため、入力で0000年と9999年12月も拒否する。繰り返し予定は終了日を処理した時点で停止し、9999年12月31日の翌日へ進めない。

## UIの境界

週間タスクの回数編集はJSTの翌週月曜から適用する。`tasks.required_completions_per_week` は初期回数として保持し、`task_weekly_requirements` にタスクID・適用週・回数を追加する。同じ適用週の再編集は予定を置換する。今週と同じ回数への変更で予定を取り消せる。名前・メモなどの更新と予定の保存は、所属・担当者・論理削除をSQLで検査した同じD1 batchで確定する。

各週の回数は「対象週以前の最新設定、なければ初期回数」で決定する。ホーム・月次の各週・過去の完了操作・SQLの完了上限・締め/再計算・Pushで同じ規則を使う。タスクID、完了記録、並び順は維持する。DTOは今週の回数と任意の `scheduledWeeklyRequirement` を返し、管理画面には適用日を表示する。変更前に既に上書きされた設定の復元や、名前・減点の履歴化は行わない。

通常の読み取りではApplicationが処理対象の週をRepositoryへ渡す。現在の表示は対象週以前の最新1件と次の予定1件、過去の完了操作とPushは対象週以前の最新1件、月次表示は月初の週の基準設定と対象月内の変更だけを取得する。履歴は削除せず、既存のタスクID・適用週の主キーで範囲を絞る。SQLの実時計を表示対象週の決定に使わない。

- 他featureのcomponents/hooks/state/libを直接importせず、`features/<feature>/index.ts` の公開APIを使います。
- 共通UIは `shared/components`、共通query/stateは `shared/query` と `shared/state` に配置します。
- ヘッダーと設定画面のチームメンバー一覧は `shared/query/teamMembersQuery.ts` のquery定義とキャッシュを共有する。設定の保存状態はmutationから取得し、編集中の値はユーザーID・チームIDで区別する。
- 追加・編集フォームは `shared/components/FormSheet.tsx` の共通シェルを使います。`FooterQuickAction` は追加ボタンとそのシェルの組み立てを担当し、featureに端末別のシェルを複製しません。
- `shared` は `features` に依存しません。画面はfeature adapterを通してServer Functionsを利用します。

### 操作のフィードバック

サマリーの過去の日間/終了済み週間タスクは、確認モーダル・待機時間なしで送信し、完了状態と操作したユーザーのアイコンを即時表示する。`features/summary/hooks/usePastTaskCompletion` が未完了mutationを対象月・日付・タスクごとの取得結果に重ねる。成功応答では保存済みキャッシュへ反映し、失敗した操作の表示だけを戻す。週複数回の成功応答は差分として反映し、応答の到着順が逆転しても古い絶対件数で後続の加算を上書きしない。項目横の「保存中…」は表示せず、合計減点やペナルティは最後の保存後のバックグラウンド再取得で同期する。対象月・画面を移動しても送信時点の月・日付を更新する。締め済み月の再計算案内と月次締め自体の確認モーダルは維持する。

サマリー更新は、送信直前にもQueryキャッシュのpending mutationを確認する。サマリーの日間・週1回は同じ対象の重複操作を防ぎ、週複数回は楽観表示の上限・下限内で連続タップを受け付ける。別日付・別タスクは独立して操作できる。保存中も操作ボタンを保持し、日間・週1回の抑止にはaria-disabledとイベント側のガードを使ってフォーカスを維持する。

家事の完了と並べ替えは、TanStack Queryの未完了mutationの入力を取得結果に重ねて即時表示する。並べ替え保存中は画面を移動しても重複操作を抑止する。保存済みキャッシュは成功応答で更新し、失敗時はそのmutationの表示だけが消える。他の操作やメンバーの完了を一括rollbackしない。日間・週1回の保存中の連打は抑止する。週複数回は連続タップを受け付け、increment/decrementを送り、D1内の件数条件で上限・下限を守る。追加・編集フォームはPromiseを返し、共通FormSheetとインライン編集は呼出元mutationの `isPending` / `isError` を表示に使う。別のref/stateへ保存状態を複製せず、保存中の入力・閉じる操作・重複送信を抑止する。失敗時は入力を保持し、再表示時にmutationをresetする。全体共通の保存中スピナーは表示せず、楽観的に更新した完了状態・件数・一覧を操作結果のフィードバックとする。mutationのpending状態・重複操作抑止・失敗時の復元は維持する。

家事の並べ替えもpending mutationから順序を導出し、保存失敗後や新しい取得結果に過去のローカル順序を残さない。完了操作は日付・タスクごとにまとめて一覧を1回走査し、同じ項目への増減は元の順序で適用する。無関係な項目・日付グループの参照を保持する。

API応答の実行時検証は共通clientの出力schemaで行う。feature hookで再検証したり、不正なDTOを一覧再取得で隠したりしない。保存応答のDTOを一覧に反映し、派生データの再取得はバックグラウンドで行う。家事完了の一覧同期は最後のpending mutationが終了するときにまとめる。楽観表示をDB保存済みの証拠として扱わず、再読込の検証では保存応答も待つ。

`lib/api/serverClient.ts` は待ち行列を持たずServer Functionsへ送信する。日間・週1回はcomplete/incomplete、週複数回はincrement/decrementという意図を送る。mutationは `networkMode: "always"` / `retry: false` とし、オフラインでも一度試みて失敗を返す。更新を自動再送しない。ログアウト・所属変更ではAbortControllerで古い通信を打ち切り、Queryキャッシュと接続を破棄する。

### 画面遷移とキャッシュ

`app/route-preload.ts` はナビゲーションのタッチ・ホバー・フォーカスで画面コードと並列にデータを先読みする。画面と先読みは `shared/query` の軽量なquery optionsを使い、画面の動的import完了を待たずにAPIを開始する。30秒の鮮度判定と実行中の通信をQueryClientで共有する。先読みは `prefetchQuery` を使い、失敗でナビゲーションを止めず再試行できる。読み取りのAbortSignalは共通clientへ渡し、所属変更後の遅い応答でキャッシュを再作成しない。

認証後のidle時間に全画面コードを読み込む処理や、ホーム以外でのホームデータ先読みは行わない。直接アクセス時は認証後に現在画面のデータを画面コードと並列に取得し、URLの集計月・予定日を反映する。カレンダーは予定定義の完了を待たず発生日を取得し、月移動時は直前の表示を保持する。WebSocketの初回接続・再接続時の同期は、購読成立前の変更を拾うため維持する。

## D1の更新

認証・業務・Pushは `infrastructure/database.ts` で作るDrizzle D1 handleを使用する。業務テーブルは `schema.ts`、認証は `auth-schema.ts`。通常のCRUDはquery builder、集計・条件付きINSERTにはパラメーター化した `sql` を使用する。

D1は対話的transactionを提供しない。複合操作は `repository.ts` の用途別コマンドが `db.batch()` で原子的に実行する。チーム移動・初期登録・担当解除・owner引継ぎは1つのbatch。完了回数はDBのCOUNTを条件に更新し、締め・過去の修正は `summary-statements.ts` の集計queryを同じbatchへ含める。batch内のSQL失敗は全体をrollbackする。認可や回数など変化する条件もSQLで検査し、外部通信はbatchへ含めない。read-modify-writeをJavaScriptで疑似transactionにしない。

家事の並べ替えは要求IDをMATERIALIZED CTEで一度展開し、索引付きの結合で順序を更新する。各行からJSON配列全体を検索しない。保存時点の対象件数・ID集合・所属の検査は同じUPDATE内で行う。

定期締めの追いつき処理は期間順に保存し、保存済みの変更があるチームへ最後に1回通知する。後続期間の失敗時も、それ以前に保存した変更を通知する。Pushは購読ごとのclaim・送信・完了記録を最大4件で並行実行し、失敗は購読単位で集計する。

同じ項目の更新はDBが後に適用したものを採用する。主キー・外部キー・日次完了の一意制約・close_runsは保持するが、team/global revision、操作ID、通知連番、再試行用の台帳はない。WebSocket通知は保存の原子性や必達性を保証しない。応答が失われた更新は再取得して結果を確認し、必要なら手動で直す。

Better Authのnickname/colorHexは追加項目（input:false）としてアプリの認可済みAPIから更新する。初期チーム作成は所属の不在をSQLで確認し、同時初回ログインでも1チームにする。最大5セッションはSQL trigger、Pushの配信済み抑止は既存の専用記録で担保する。D1 read replicationは無効で、すべてprimaryへ読み書きする。

Better Authの `advanced.database.joins` とDrizzleのrelation metadataを使い、sessionとuserを1回のDB照会で取得する。Cookie認証キャッシュは使わず、各リクエストで失効を確認する。業務SQLと応答前のアクセス検査も維持する。

## リアルタイム同期と接続メンバー

`server-entry.ts` の `/api/realtime` は `realtime.server.ts` でOrigin・Better Authセッション・所属を検証する。チームとユーザーはブラウザーから受け取らず、サーバーが特定して `TEAM_REALTIME.getByName(teamId)` に接続する。HTTP101は共通ヘッダー処理で作り直さない。Service Workerの `/api/` 除外にはこの経路も含む。

`infrastructure/team-realtime.ts` のTeamRealtimeは公式WebSocket Hibernation APIを使い、認証済みuserId/sessionId/teamIdをattachmentに保存する。復帰時は `getWebSockets()` と `deserializeAttachment()` から一覧を作る。接続一覧・業務データをDOのSQLに保存しない。通知時にセッション期限・失効・所属を検査し、不正な接続を閉じる。D1への認可照会と配信は公式`blockConcurrencyWhile`内で実行し、その間の入退室による未検証接続への配信・presenceの順序逆転を防ぐ。この範囲に業務データの更新は含めない。認可照会失敗時はログを残して接続を閉じ、再接続へ戻す。複数タブはuserIdでまとめ、最後の接続を閉じたときにpresenceの接続中一覧から外す。

メッセージは `contracts/realtime.ts` のpresence（userIdsの全置換）とteam-changed（再取得通知）。team-changedの任意のchangesには業務上の変更範囲を載せ、関連するQueryだけを無効化する。`application/operation-changes.ts` が全operationの読み取り/変更範囲を型付きで定義する。changesのない旧形式・定期ジョブの通知は全体再取得として扱う。Server FunctionsとジョブはD1保存後に通知し、失敗は構造化ログへ記録する。通知失敗を保存失敗にしない。

`useTeamRealtime.ts` は共通レイアウトに1接続を持ち、ページ移動では再接続しない。接続・復帰では全体を同期し、team-changedでは変更範囲に対応するQueryを再取得する。mutation中の通知は変更範囲の和集合として終了までまとめ、全体通知を優先する。楽観表示を上書きしない。切断時は接続中ユーザーIDの一覧を空にして再接続状態へ切り替え、指数バックオフで接続だけを再試行する。業務更新は再送しない。

ヘッダーのConnectedMembersは自分を含むチームメンバーを接続の有無にかかわらず表示する。接続中は通常色、未接続は彩度・不透明度を下げたグレー寄りの表示とする。自分の通信が切れた場合もアイコンは残し、全員を薄い色の「接続確認中」として古いpresenceを表示に使わない。スマートフォンは左にチーム名と日付、右上にメンバーのアイコンを置き、PCでは横一列にする。アイコンは先頭2人まで表示し、残りは「+人数」に集約してタップで全員の名前・状態・アイコンを確認できる。名前と接続状態はタップ、ホバー、キーボードフォーカスで確認でき、Escapeまたはフォーカスが外れると閉じる。閲覧ページや操作中状態は収集しない。他メンバーの通信断・強制終了ではサーバーの切断検知まで接続中表示が残る。

公式資料: [DOの同時実行制御](https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile)、[DOクラス宣言](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)、[WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)、[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)。

## SQLと運用

`app/migrations/` がSQLの正本。新規DBには全migrationを番号順に適用する。`0002_unify_users.sql` はユーザーをBetter Authへ統合し、`0003_iso_timestamps.sql` は認証・レート制限・Pushの日時をUTC ISO文字列へ統一する。`0004_remove_revisions.sql` はteams.state_revisionとapp_revisionだけを削除する。既存D1のプロフィール・外部キー・履歴を保持する。Drizzle定義と適用済みDBのテーブル・列・主キー・外部キーは統合テストで照合する。テーブルの責務は [database.md](database.md) に記載する。旧DBの履歴やデータ移行は持たない。以降のschema変更は新しい番号のSQLとして追加し、適用済みファイルを編集しない。

`app/alchemy.run.ts` と `app/infra/` がWorker・D1・TeamRealtimeのDO binding・ドメイン・Secrets・Cronを管理する。Alchemyの公開DurableObject APIを使い、既存Workerからクラスをexportする。ローカルwrangler.jsoncには同じbindingと、公式の`exports`によるSQLite DOクラス宣言を持つ（D1のSQL migrationとは別）。SQLite DOなのでWorkers Freeでも利用できる（利用枠内）。配備時のSQL適用はAlchemyが管理する。ローカルはWranglerで同じSQLを適用する。環境はlocalとproductionだけとし、WranglerのローカルDBと本番D1を共有しない。本番のIaCはproduction以外のstageを拒否する。

本番配備は `.github/workflows/deploy-production.yml` がmain更新時にproduction Environmentの設定でplan/deployを実行する。CIはPR時に実行し、CDでは再実行しない。mainの保護ルールでPRと `cloudflare-quality` の成功を必須にする。SecretsはCIへ渡さず、配備stepに限定する。配備の直列化を維持する。

### ビルドと配備の分担

TanStack Start/Cloudflare公式の `@cloudflare/vite-plugin` で `vp dev` / `vp build` / `vp preview` を実行する。独自Worker入口 `src/server-entry.ts` は維持し、build出力は `dist/server/index.js` と `dist/client`。StartがSPA shellを出力した後、esbuildで `src/sw.ts` を単体の `sw.js` にまとめ、Workboxがshellと静的ファイルの一覧を埋め込む。現行web-push依存にはNode組込moduleへのrequireが残るため、従来のcreateRequire bannerは維持する。Cloudflare pluginがplatformをneutralにするため、単にNode出力を指定しても代替できない。依存更新で不要になった時点で撤去する。

Alchemyは `Cloudflare.Worker("Application", { bundle: false, ... })` でbuild済み生成物を配備する。`Website.Vite` とAlchemy独自Vite pluginは使用しない。stack名・Application/Databaseの論理ID・本番bindingは維持する。ローカルはwrangler.jsonc、本番のリソースと実行時設定はalchemy.run.ts/infra/config.tsが管理する。build出力のローカル用DB IDやvarsを本番へコピーしない。

CDは本番Secretsを渡さずbuildし、その後のstepでAlchemy bootstrap → plan → deployを実行する。CIの再実行はしない。build出力の入口・assetsディレクトリを変えた場合はIaCも更新し、test:localで一致を検証する。

公式資料: [CloudflareのTanStack Start構成](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)、[Alchemyのビルド済みWorker配備](https://alchemy.run/providers/cloudflare/workers/worker/#configuration)。

## 設定画面

設定はプロフィール・表示・通知・チーム・アプリに分け、PCの左メニューとモバイルの3列メニューで切り替える。設定パネルはhiddenで保持し、切り替えで未保存入力・保存中・エラー状態を失わない。チームの参加・離脱は「チームの参加・切り替え」にまとめる。保存先は各カテゴリー見出しに表示する。

設定を含む全画面で、保存中のメッセージ・保存用スピナーは表示しない。保存ボタンは元のラベル・アイコンを保ち、pendingによる重複送信・入力・閉じる操作の抑止とaria-busyは維持する。並び替えや設定の楽観表示、失敗時の復元・入力保持と通知を操作結果のフィードバックとする。共有ページの保存中ラベルも出さず、未保存・保存済み・失敗と復旧手段を維持する。

## アプリの更新確認

手動確認はService Workerの更新スクリプトをHTTPキャッシュ経由にせず確認する。背景・フォーカス・手動の同時要求は1つにまとめる。更新は `updatefound` / `installing` の段階で通知し、全静的ファイルのprecache完了をトースト表示の条件にしない。すでに更新を取得中・待機中ならネットワークを待たず案内を再表示する。activeのない初回インストールは更新として通知しない。

「更新する」を選んだ後にインストール完了を待ち、対象workerへSKIP_WAITINGを送り、そのworkerがcontrollerになったことを確認して再読み込みする。準備中は進行表示を維持し、二重適用を抑止する。インストール失敗・適用失敗・timeout時には勝手に再読み込みせず、再確認を案内する。閉じた案内をインストール完了だけで再表示しない。更新スクリプトを取得する通信時間自体は残る。

参照: [updatefound](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updatefound_event)、[Workboxのライフサイクル](https://developer.chrome.com/docs/workbox/modules/workbox-window)。

## 表示モード

設定の「表示」でシステム・ダーク・ライトを選べる。初期値はシステムで、`shared/state/theme.ts` のJotai atomが `kaji:theme:v1` に文字列を保存する。ユーザー/チームのDB設定ではなくブラウザー単位で、ログイン前も同じ選択を使う。storageイベントで別タブの変更/削除を反映し、保存不可時は現在の選択を適用して通知する。

Documentのhead内の固定スクリプトがCSS・本文の描画前にhtmlの `data-theme` を設定する。`color-scheme` と用途別の `light-dark()` トークンで全画面・ポータル・ネイティブ入力を切り替える。システムではCSSがOS変更に追従し、常時mountする `ThemeSync` がブラウザーのtheme-colorも同期する。アプリのJavaScriptが未読込でも初期配色を保持する。
