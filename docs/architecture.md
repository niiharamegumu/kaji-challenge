# アーキテクチャ

## 常駐音声アシスト

1回の指示に含まれる複数のToDo操作は順序付きplanとして扱う。推論は単独操作も配列で返し、`assistInferenceIntentSchema`で検証後に単独操作の既存契約へ変換するか、`batch_todos`として全件処理する。最大10操作・指定項目合計50件。全操作の不足情報とカテゴリーを確認し、必要なら完了/削除を含むplan全体をdraftに保持して何も実行せず聞き返す。`ApplyTodoAssistActionsAtomic`が全体の認証・チーム・カテゴリー条件を各SQLに適用し、追加/削除/検索を単一D1 batchで順に処理する。SQL失敗は全体を戻し、各操作の実結果を順序通り返して画面にもすべて表示する。推論・予算予約・変更通知は1送信につき1回とし、自動再送しない。

`features/assist` の公開APIをRootLayoutが組み立て、shellへ起動callbackと状態だけを渡す。新しいページは追加せず、カレンダーを「その他」に残す。共通ダイアログは `shared/state/overlay` で競合を避ける。

ブラウザーの録音終了では、AudioWorkletから受信したPCMの総数を照合してマイクを解放する。WAV化は同featureのDedicated WorkerへPCMの所有権を転送して実施し、画面描画のスレッドを占有しない。Workerから受け取るWAV BlobをFormDataでアプリへ送り、端末ではbase64化しない。transportが上限付きmultipart解析と実WAV検証後に、Workers AI向けのbase64へ変換する。旧PWAのJSON/base64入力も既存の上限・検証で受け付ける。送信表示の更新後は直ちにWorkerへ変換を渡す。処理完了のawait中にブラウザーが描画できる構成とし、frame数や固定時間による描画待ちを挟まない。終了・中断・変換エラーではWorkerも破棄し、同期変換へ戻すfallbackは持たない。

音声は `contracts/assist.ts` → `transport/assist.server.ts` → `application/assist-operations.ts` → 既存 `executeOperation` / Repositoryで扱う。Applicationの `AssistAi` portを `infrastructure/assist-ai.ts` が実装する。音声認識・意図解析は既存アプリWorkerからのみ呼び、LLMの出力をDB命令として実行しない。WAV検証・本人/所属の固定・再送抑止と運用手順は [voice-assist.md](voice-assist.md) を参照する。

`AssistBudget` portを `infrastructure/assist-budget.ts` が実装し、AIの前に永続カウンターを条件付きUPDATEで予約する。複数ToDoは全件を検証後、Repositoryの単一D1 batchで保存する。どちらも並行リクエストで上限超過や部分保存が起きないことを実D1で検証する。

アシストのintentはToDoの追加・一覧/検索・完了・削除を区別し、編集や他機能はunsupportedとする。「ToDoに〜」の明示的な指示と自然な買い物表現を同じ契約に解釈する。登録済みカテゴリー名だけをAIへ渡し、追加先を意味から推測させる。不明/存在しないカテゴリーは聞き返す。表示初期カテゴリーは追加先として固定しない。検索はカテゴリーと正規化した名前の部分一致を組み合わせ、保存順の先頭20件と総数を返す。完了・削除は名前の完全一致で全同名を対象にし、カテゴリーの明示指定時はその中に限定する。`DeleteTodoItemsByNames` がJSONでbindした名前集合と現在の認証・チーム・カテゴリー条件を単一DELETE内で検証する。完了は既存の物理削除と同じで、履歴を新設しない。結果は削除件数から生成し、変更時だけ既存のToDo通知を送る。

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

## MCP連携

`src/server/transport/mcp-worker.ts` は独立したCloudflare Workerで、Agents SDKのstateless `createMcpHandler` とStreamable HTTPを使う。公開操作は `contracts/mcp.ts` の `list_todos`・`add_todo`・`update_todo`・`complete_todo` のみ。userId/teamIdをツール引数として受け取らず、ToDoの返却DTOにもteamIdを含めない。更新は既存の `patchTodoItem` を再利用し、itemIdとname・notes・categoryIdだけを受け付ける。省略は保持、notes/categoryIdのnullは解除、未知キー・空更新は拒否する。更新は上書き、完了は既存の物理削除を再利用する操作として、破壊的操作のannotationを付ける。

サーバーアイコンは標準のserverInfo `icons` に設定する。既存の `public/icons/pwa-192x192.png` をbundleし、MCP originの `/icons/kajichalle-192.png` で認証不要のGET/HEADとして返す。追加のasset binding・外部画像取得・CORS許可は不要で、ツールの認証境界は維持する。OAuth画面は本体の配色に合わせた静的HTML/CSSとテキストのブランド名を使い、画像・外部フォント・scriptを読み込まず、既存CSPを維持する。クライアントがアイコンを表示するかどうかはクライアント側の実装とmetadata更新に依存する。

既存アプリの `mcp-oauth.ts` がworkers-oauth-providerのOAuthAuthorizationServerを `/api/mcp/oauth` に配置し、同じoriginのBetter Authセッションで同意者を確認する。既存Google callback・セッション・trustedOriginsは変更しない。S256 PKCE、正確なresource、許可したscopeを要求する。認可コード・access token・クライアント登録はproviderのOAUTH_KVへ保存する。同意はproviderのnonceに加え、D1の一回限りのclaimを本人・現在のセッション・表示した期間のpolicyに結び付ける。Google tokenやログインCookieをMCP tokenとして流用しない。

MCP WorkerはOAuthResourceServerとして、片方向の `KAJI_APPLICATION` Service Bindingから既存Workerのnamed entrypoint `McpApplication` を呼ぶ。通常HTTP入口にRPCは公開しない。KVを持つ既存Workerでtokenを検証し、検証済みuserId/clientId/audience/scope/expiryとconnectionIdだけを内部RPCで渡す。任意のHTTPヘッダーによる本人指定はない。このbindingを付与できる配備権限は信頼境界に含む。MCP WorkerにはDB・KV・Google/Better Authの秘密情報をbindしない。

Applicationの `mcp-operations.ts` は毎回、連携の所有者・grant・期限・失効・実tokenのscopeと現在の所属1件・roleを検査する。追加/更新/完了は既存 `executeOperation` を使い、入口で確定した本人・チームのRepositoryを引き継ぐ。所属を再解決する途中に移動しても別チームへ更新先を切り替えない。ToDo SQLでも対象teamIdと現在の所属、連携状態、許可scope、変更先カテゴリーが同チームにあることを検査し、他チームの項目IDや検証後の解除を拒否する。保存後は既存のToDo変更通知を再利用し、応答不明の書き込みは自動再送しない。

新しい連携は同意から最大7日、access tokenのTTLは最大604800秒でD1の残期限にも制限する。SDK標準の `refreshTokenTTL: 0` と既存callbackでrefresh発行・交換を止める。新規の要求・広告は `todos:read` / `todos:write` のみとし、`offline_access` は付与しない。自動更新せず、期限後は再接続・再同意が必要となる。ログアウトでは解除されない。古い同意画面・未交換コードは新policyを持たないため拒否し、発行済み15分tokenは元の期限を保つ。旧tokenに含まれるoffline_accessは旧token検証に限って許容し、操作権限や更新権限にはしない。D1の旧30日許可記録も書き換えず、管理画面ではtokenの有効期限・接続状態と区別する。

SDKは相対TTLをtoken保存前に加算するため、KV待機によってproviderのexpiryがD1期限を越える場合がある。McpApplicationがRSへ渡す検証結果のexpiryもD1期限で制限し、Application・業務SQLは毎回元のtoken期限とD1期限を検査する。SDK単体の秒単位の期限判定に依存せず、期限と同時刻でアプリのアクセスを拒否する。

`/api/mcp/connections` で本人が解除するとD1を先に失効させ、続いてproviderのgrantを失効させる。標準RFC 7009失効も、providerがclient認証・token真正性・所有者を確認した後、管理patchのcallbackでD1を先に失効させる。新access・旧refreshのどちらでも対応する連携全体を止める。KV削除失敗や切替前から進行中の発行でtokenが残っても、D1で業務操作を拒否する。D1更新に失敗した失効要求は503とし、成功扱いしない。依存patchの範囲と更新手順は [mcp-oauth-provider-patch.md](mcp-oauth-provider-patch.md) に従う。チーム移動後は現在所属するチームが対象となり、この挙動を同意画面に表示する。

AlchemyではMCP_ORIGIN設定時にOAuth KVを宣言し、MCP_ENABLED=trueのときだけ専用MCP Workerを追加する。falseでの配備は専用WorkerとそのCustom Domain・Service Bindingを除去する。専用Workerのローカル実行でもfalseならhealth・アイコン・discoveryを含む全HTTP入口を404にし、既存ApplicationのOAuth・連携管理・named RPCも拒否する。通常認証・ToDo・Realtimeはこのflagに依存しない。

停止中もMCP_ORIGIN、KV宣言とretain、D1テーブル・データ、MCPコード・build・named export・依存patchを保持する。MCP_ORIGINの削除はKVがAlchemy管理から外れるため停止手段として使わない。再開はtrueで再配備する。無効化は認可データの削除・失効ではなく、再開後は残存する有効な連携を利用できる。専用データ消去は別途承認された操作として扱う。

## Server Functions

入口と全業務SQLの認可条件、Cron/初回所属/本人操作の区別、テスト対応表は [authorization.md](authorization.md) を参照する。通常セッションは検証済みuserId/sessionIdをRepositoryへ引き継ぎ、SQLでも失効・現在所属・対象チームを照合する。

`operations.functions.ts` は静的importできる `createServerFn` の入口。`validator` でZod検証し、handlerでsession/originを検証、Applicationでチーム認可を実施する。入力不正・業務エラーは型付き結果で返し、SQLや認証情報を返さない。入力と認可の検証後、用途別Repository操作で保存する。返却DTOも出力schemaで検証するが、既にcommitした保存は応答検証の失敗では取り消せない。結果はStartのシリアライズへ渡し、手動のJSON stringify/parseは行わない。

feature adapter → 共通client → Server Function → Application → Repositoryという構成は、Startのserver-only処理とUIの分離に従う。TanStack Queryがキャッシュ・再取得・mutationを管理する。単一のdiscriminated unionによるoperation入口はこのアプリの設計であり、Startの必須形式ではない。routeのbeforeLoadだけを認証境界にしない。

共通Server FunctionはPOST。読み取りoperationはD1を更新しない。予定の発生日取得では、既存のチーム/開始日indexを使い、対象期間に重ならない定義と期限切れ単発予定をD1で除外してから発生日を展開する。期限切れ単発予定は表示時に除外し、日次ジョブで削除する。集計の保存は締め・過去の完了修正時だけ行う。Startのredirectを返さず既存のエラー処理を使うため、共通clientから静的importした関数を直接呼ぶ。`useServerFn` はredirect等をRouterと連携するときに検討する。Server Function応答はWorker入口でno-storeにする。

認証HTTP・Server Functions・OAuth providerに渡す本文は、frameworkのJSON/form解析前に実ストリームのバイト数を数え、1 MiB超過で413を返す。Content-Lengthの欠落や過少申告にも同じ上限を適用する。MCPツールの128 KiB、ブラウザー同意フォームの16 KiBという既存の小さい上限も保持する。予定の発生日取得は開始日から終了日まで両端を含め366日以内に制限し、契約とApplicationの両方で、DB取得・繰り返し展開・今日への期間補正より前に検査する。

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

ToDo完了は確認モーダルを表示せず、取消猶予中は完了待ちとして一覧に残し、各項目内のボタンから取り消せる。猶予は初期3秒で、設定画面の「このブラウザーの設定」からネイティブのselectで1秒・2秒・3秒・4秒・5秒を選べる。`shared/state/todoCompletionDelay` のJotai atomが設定を共用し、既存のversion付きlocalStorageキーに1000ms単位の整数ミリ秒を保存する。本人・チームのDB設定ではなく、同じブラウザープロファイルの設定として扱う。初期renderは3000msで一致させ、mount後に保存値を読む。旧スライダーの有効な保存値（100〜5000msの整数かつ100msの倍数）は最寄りの整数秒へ四捨五入し、最小1秒として読み込む。読込時には保存値を書き換えず、次の選択変更で新しい値を保存する。数値以外・旧範囲外・100msの倍数以外は丸めず3000msへ戻す。保存に失敗しても現在の設定は適用し、設定画面で永続化失敗を知らせる。別タブの設定変更・削除はstorageイベントで同期し、旧設定も同様に正規化する。

ボタン内には残り時間を秒単位で切り上げ（初期値では3→2→1）て示す円形プログレスを表示し、画面下部に取り消しバナーは表示しない。認証済みRootLayout内の `shared/state/DelayedActionProvider` が項目ごとのタイマーを管理し、予約時にJotai storeの現在値を読み取って猶予と期限を固定する。設定の購読による再描画が遅れても直前の設定を使う。設定変更は次の予約から適用し、進行中の期限や円の長さは変えない。カテゴリーや画面を切り替えても待機を継続し、再表示した項目は元の期限から残り時間を計算する。ユーザー/チーム変更・ログアウトでproviderを破棄すると未実行の操作を取り消す。待機中はAPIや保存済みキャッシュを変更せず、猶予後に既存の削除mutationを1回実行する。ブラウザーの再読み込みや終了をまたいで未確定操作を保存・再送しない。

サマリーの過去の日間/終了済み週間タスクは、確認モーダル・待機時間なしで送信し、完了状態と操作したユーザーのアイコンを即時表示する。`features/summary/hooks/usePastTaskCompletion` が未完了mutationを対象月・日付・タスクごとの取得結果に重ねる。成功応答では保存済みキャッシュへ反映し、失敗した操作の表示だけを戻す。週複数回の成功応答は差分として反映し、応答の到着順が逆転しても古い絶対件数で後続の加算を上書きしない。項目横の「保存中…」は表示せず、合計減点やペナルティは最後の保存後のバックグラウンド再取得で同期する。対象月・画面を移動しても送信時点の月・日付を更新する。締め済み月の再計算案内と月次締め自体の確認モーダルは維持する。

ToDo追加とサマリー更新は、送信直前にもQueryキャッシュのpending mutationを確認する。サマリーの日間・週1回は同じ対象の重複操作を防ぎ、週複数回は楽観表示の上限・下限内で連続タップを受け付ける。別日付・別タスクは独立して操作できる。保存中も操作ボタンを保持し、日間・週1回の抑止にはaria-disabledとイベント側のガードを使ってフォーカスを維持する。

家事の完了・ToDo完了/編集/並べ替えは、TanStack Queryの未完了mutationの入力を取得結果に重ねて即時表示する。ToDoはホームと専用画面で同じhookから楽観表示を導出し、コンポーネント内に順序stateを複製しない。並べ替え保存中は画面を移動しても重複操作を抑止する。保存済みキャッシュは成功応答で更新し、失敗時はそのmutationの表示だけが消える。他の操作やメンバーの完了を一括rollbackしない。日間・週1回の保存中の連打は抑止する。週複数回は連続タップを受け付け、increment/decrementを送り、D1内の件数条件で上限・下限を守る。追加・編集フォームはPromiseを返し、共通FormSheetとインライン編集は呼出元mutationの `isPending` / `isError` を表示に使う。別のref/stateへ保存状態を複製せず、保存中の入力・閉じる操作・重複送信を抑止する。失敗時は入力を保持し、再表示時にmutationをresetする。全体の保存中表示は `shared/components/MutationFeedback.tsx` が担当する。

家事の並べ替えもpending mutationから順序を導出し、保存失敗後や新しい取得結果に過去のローカル順序を残さない。完了操作は日付・タスクごとにまとめて一覧を1回走査し、同じ項目への増減は元の順序で適用する。無関係な項目・日付グループの参照を保持する。

API応答の実行時検証は共通clientの出力schemaで行う。feature hookで再検証したり、不正なDTOを一覧再取得で隠したりしない。保存応答のDTOを一覧に反映し、派生データの再取得はバックグラウンドで行う。家事完了の一覧同期は最後のpending mutationが終了するときにまとめる。楽観表示をDB保存済みの証拠として扱わず、再読込の検証では保存応答も待つ。

`lib/api/serverClient.ts` は待ち行列を持たずServer Functionsへ送信する。日間・週1回はcomplete/incomplete、週複数回はincrement/decrementという意図を送る。mutationは `networkMode: "always"` / `retry: false` とし、オフラインでも一度試みて失敗を返す。更新を自動再送しない。ログアウト・所属変更ではAbortControllerで古い通信を打ち切り、Queryキャッシュと接続を破棄する。

### 画面遷移とキャッシュ

`app/route-preload.ts` はナビゲーションのタッチ・ホバー・フォーカスで画面コードと並列にデータを先読みする。画面と先読みは `shared/query` の軽量なquery optionsを使い、画面の動的import完了を待たずにAPIを開始する。30秒の鮮度判定と実行中の通信をQueryClientで共有する。先読みは `prefetchQuery` を使い、失敗でナビゲーションを止めず再試行できる。読み取りのAbortSignalは共通clientへ渡し、所属変更後の遅い応答でキャッシュを再作成しない。

認証後のidle時間に全画面コードを読み込む処理や、ホーム以外でのホームデータ先読みは行わない。直接アクセス時は認証後に現在画面のデータを画面コードと並列に取得し、URLの集計月・予定日を反映する。カレンダーは予定定義の完了を待たず発生日を取得し、月移動時は直前の表示を保持する。WebSocketの初回接続・再接続時の同期は、購読成立前の変更を拾うため維持する。

## D1の更新

認証・業務・Pushは `infrastructure/database.ts` で作るDrizzle D1 handleを使用する。業務テーブルは `schema.ts`、認証は `auth-schema.ts`。通常のCRUDはquery builder、集計・条件付きINSERTにはパラメーター化した `sql` を使用する。

D1は対話的transactionを提供しない。複合操作は `repository.ts` の用途別コマンドが `db.batch()` で原子的に実行する。チーム移動・初期登録・担当解除・owner引継ぎは1つのbatch。完了回数はDBのCOUNTを条件に更新し、締め・過去の修正は `summary-statements.ts` の集計queryを同じbatchへ含める。batch内のSQL失敗は全体をrollbackする。認可や回数など変化する条件もSQLで検査し、外部通信はbatchへ含めない。read-modify-writeをJavaScriptで疑似transactionにしない。

家事・ToDoの並べ替えは要求IDをMATERIALIZED CTEで一度展開し、索引付きの結合で順序を更新する。各行からJSON配列全体を検索しない。保存時点の対象件数・ID集合・所属の検査は同じUPDATE内で行う。

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

TanStack Start/Cloudflare公式の `@cloudflare/vite-plugin` で `vp dev` / `vp build` / `vp preview` を実行する。独自Worker入口 `src/server-entry.ts` は維持し、build出力は `dist/server/index.js` と `dist/client`。SPA shellはStart、Service WorkerとprecacheはVite PWA/Workboxが生成する。現行web-push依存にはNode組込moduleへのrequireが残るため、従来のcreateRequire bannerは維持する。Cloudflare pluginがplatformをneutralにするため、単にNode出力を指定しても代替できない。依存更新で不要になった時点で撤去する。

Alchemyは `Cloudflare.Worker("Application", { bundle: false, ... })` でbuild済み生成物を配備する。`Website.Vite` とAlchemy独自Vite pluginは使用しない。stack名・Application/Databaseの論理ID・本番bindingは維持する。ローカルはwrangler.jsonc、本番のリソースと実行時設定はalchemy.run.ts/infra/config.tsが管理する。build出力のローカル用DB IDやvarsを本番へコピーしない。

CDは本番Secretsを渡さずbuildし、その後のstepでAlchemy bootstrap → plan → deployを実行する。CIの再実行はしない。build出力の入口・assetsディレクトリを変えた場合はIaCも更新し、test:localで一致を検証する。

公式資料: [CloudflareのTanStack Start構成](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)、[Alchemyのビルド済みWorker配備](https://alchemy.run/providers/cloudflare/workers/worker/#configuration)。

## ToDo

ホームとToDo画面で最初に選択するカテゴリーは、設定画面の「このブラウザーの設定」から指定する。表示順とは独立し、「すべて」は引き続き先頭固定。ToDo featureの `model/defaultTodoCategory` と `useTodoDefaultCategory` がversion付きlocalStorageキーへユーザー・チーム別に保存する。「すべて」「未分類」「カテゴリーID」を区別し、名前変更・並べ替えでは設定を維持する。SSR/初回描画ではstorageを読まずmount後に復元し、各画面で初期設定を一度採用した後は手動選択を保持する。削除済みIDや不正値は「すべて」へ戻し、取得待ちでは削除扱いにしない。保存失敗は設定画面で通知し、未保存の値を適用しない。別タブの変更は設定欄に同期するが、既に開いている一覧の選択を変更しない。端末間の同期やDB設定にはしない。

ホームとToDoページの一覧（空表示と一覧下の余白を含む）は共通の `TodoCategorySwipeArea` で横スワイプを受け付け、`useTodoCategoryFilter` で保存されたタブ順に1つ切り替える。ToDoページはRootLayoutから一覧までのflexで画面内の残りの高さを割り当て、ホームはToDoパネル内に最低16remの一覧領域を確保する。項目数によってスワイプ範囲を縮めず、多数の項目では内容に合わせて高さを伸ばす。左で次、右で前へ移り、先頭/末尾で止まる。タブ列自体は横スクロールを維持し、選択したタブが隠れている場合は列内だけをスクロールする。縦スクロール・ピンチズームを許可し、短い移動、縦方向、中断、複数指、操作ボタン・リンク・編集フォームからの操作は切り替え対象にしない。

`features/todos`を公開境界とし、専用ページは`/todos`。ホームも同じToDo query/mutationを使う。カテゴリー管理は「その他」から開く`/todo-categories`へ分離する。追加・編集フォームのカテゴリーは「未分類」と登録済みカテゴリーから選択する。初回取得中・失敗は登録0件と区別し、取得が完了するまで選択と保存を無効にする。失敗時は再試行でき、既存の候補キャッシュがあれば再取得失敗時も維持する。フォーム表示中に選択済みカテゴリーが候補から消えたら、その選択だけ未分類へ戻し、名前・メモを保持する。ホームのToDo見出しと専用ページの「現在のToDo」の下に「すべて」を先頭固定し、その後に保存されたカテゴリー順（未分類を含む）の切り替えボタンを置き、1行の横スクロールで表示する。絞り込み中の並び替えは表示対象の位置だけを置き換え、全体のID順をAPIへ送る。カテゴリー候補のqueryもチーム変更・リアルタイム通知で再取得する。

カテゴリー管理では未分類を含む一覧をドラッグ（スマホは長押し）またはキーボードで並べ替える。APIのカテゴリー配列は登録カテゴリーを固定UUID付きの`{ id, name }`、未分類を`null`で表現し、全カテゴリーの表示順を返す。ToDoの関連・選択・フィルター・削除・DnDはIDを使用し、並べ替えはIDとnullの配列`categoryIds`だけを送る。管理画面・ホーム/ToDoのタブ・追加/編集の選択欄はこの順序を共用する。保存中はmutationの入力を管理画面へ重ね、追加・削除・再ドラッグを抑止する。失敗時は保存済み表示へ戻し、一覧を再取得する。実体のない未分類は削除不可で、同じ名前の登録カテゴリーと区別する。

登録済みカテゴリーの名前は管理画面の編集から変更する。固定IDを指定し、SQL内で現在の配列位置・所属・他カテゴリーとの名前重複を検査して名前だけ更新する。ID・表示順・ToDoの参照は保持する。未分類は編集不可。名前は前後空白除去後1〜50文字で、同じチームの他カテゴリーと同名にはできない。編集モーダルは共通FormSheetを使い、保存中の操作抑止と失敗時の入力保持を行う。保存応答のカテゴリー一覧をqueryキャッシュに反映する。
