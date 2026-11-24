# テスト方針

挙動を観測できる最小の層で検証します。実DBテストのskipを成功として報告しません。

- UI: Vitest/Testing Libraryで表示・操作・loading/empty/errorを検証します。mockはfeature API adapterの境界に置きます。
- 設定画面ではカテゴリー切替時の入力保持・表示対象の分離と、ヘッダーのメンバーキャッシュ再利用、プロフィール保存中の操作抑止、失敗時の入力保持・再試行、同名の別チームへ移動した際のdraft分離を確認します。保存応答を保留し、保存ボタンのラベルを保ったまま進行表示を出さず重複送信を防ぐことを共通FormSheetと各設定で確認します。
- Domain: 日付境界、月またぎ週、完了規則、予定を決定的なfixtureで検証します。`app/tests/fixtures/domain-scenarios.json` は業務規則の期待値です。
- Application/DB: 認可、チーム越境、競合とrollback、締めの冪等性、認証失効・セッション数を使い捨てのローカルD1で検証します。
- `team-access.test.ts` は全業務Repositoryのread/list/create/update/deleteを他チーム・所属移動/削除・セッション失効/期限切れで確認します。通常入口の偽装IDとSQLの対応は [authorization.md](authorization.md) を参照します。
- API契約: Zod入出力・DTOを正本とし、意図を指定した完了操作と、revisionを含まないtransport/adapterを確認します。
- 通信: 所属変更・ログアウト時の古い通信の破棄、更新失敗時の再取得、オフライン更新の自動再送抑止を確認します。
- 操作フィードバック: 遅延中の家事の完了表示、失敗した操作だけの復元、週次連続3タップ、フォームの入力保持を確認します。
- Transport/DB: 入力不正・未認証・異なるOriginを拒否します。用途別D1 batchの制約違反は全体rollbackします。出力DTO検証は保存後であるため、検証失敗時もcommit済みデータは残ることを明示的に検証します。
- リアルタイム: 認証済みユーザーからのチーム選択、Origin拒否、失効・期限切れ・脱退接続への配信停止、複数タブの重複排除、attachmentからのインスタンス復元、未検証接続への配信拒否、attachment不正・復元失敗を検証します。後者はHibernation APIの契約を模した単体テストであり、実Cloudflareの休止スケジューリングを再現したものではありません。
- 接続UI: 切断時の古いpresence破棄・メンバーの常時表示・接続確認中への切替、再接続・Query再取得、mutation中の通知集約、画面遷移での接続維持を検証します。実WorkersのE2Eで2ユーザー間の家事の完了・取消、アイコンの接続中/未接続切替とチーム分離を確認します。
- ブラウザー: Workers previewとローカルD1を使い、desktop/mobileで画面遷移、保存、ドラッグ、戻る操作、PWA offline shellを確認します。
- PWA更新: 更新検出とダウンロード待ちを分離して検証します。単体では初回インストールの除外、手動確認の即時応答、重複ネットワーク要求/適用の抑止、インストール失敗、controller切替の対象、timeoutと再試行を確認します。PC/モバイルChromiumでは実Service Workerのshell取得を保留し、その取得完了前にトーストの表示・閉じる・手動再表示が可能で、「更新する」後は進行表示を維持し、取得と適用の完了後だけ再読み込みされることを確認します。オフライン確認失敗後の再試行も検証します。
- 秘密情報: `.gitignore` の実Git判定、認証ログの機密値抑止、短いsession secret・非ローカルHTTP originの拒否を検証します。依存関係はCIの `bun audit --audit-level moderate` で確認します。ignoreのテストは、既に追跡された秘密値の検出や履歴スキャンを代替しません。
- OAuth保存: Better Authの初回/再ログインとrefresh経路でaccess/refresh tokenの暗号化・復号、ID token非保存を実DBで確認します。Googleによる署名検証は別の確認範囲です。

## コマンド

- UI: `make test`
- build・型・format・lint・境界・UI: `make check`
- 境界: `make architecture-check`
- server/DB: `cd app && bun run test:server --run`（fixtureがD1を自動作成・破棄）
- 全体: `cd app && bun run test:local`
- PRの変更範囲に応じた検証: `cd app && bun run test:ci`（`KAJI_CI_BASE` にPR baseのcommit SHAを指定。未指定・取得失敗は全体検証）

## ローカル一括検証

ホストのNode.js・Bunは `mise.toml` で管理する。初回はリポジトリ直下で `mise trust && mise install` を実行し、`cd app && mise exec -- bun x --no-install playwright install chromium` でブラウザーを準備する。5194/5195ポートを空けて、`app/` で `mise exec -- bun run test:local` を実行する。miseをシェルで有効にしている場合は `mise exec --` を省略できる。Dockerや外部DBは不要。

一括検証は一時ディレクトリにソースをコピーし、テスト専用の認証設定とD1保存先を使う。普段の `.dev.vars` / `.env*` / `.wrangler` はコピーしない。終了時に一時DBを破棄し、成功・失敗結果とブラウザー証跡を `app/test-results/` に保存する。

Alchemyのbootstrap/plan/deployは `--help` でCLI起動を確認し、アプリのbuildだけでは検出できない実行時peer依存の欠落・バージョンの不整合を検出する。`ALCHEMY_HOME` は一時ディレクトリへ向け、実資格情報の読み込みやクラウドへの配備を行わない。Effectとplatform-bun/platform-node、およびoverrideしたplatform-node-sharedはAlchemyのpeer要件を満たす同じバージョンで更新する。依存更新時も監査の除外を追加せず `bun audit --audit-level moderate` を実行し、配備ツール更新の本番確認は [Issue #153](https://github.com/niiharamegumu/kaji-challenge/issues/153) で追跡する。

PRのCIは `test:ci` で、format・build・型・lint・境界・UI全件・server/DB/認証全件を毎回検証する。ブラウザーはdesktop/mobileのログイン入口・主要画面遷移・家事の操作を `@smoke` として毎回実行し、変更した機能のタグを追加する。認証・共通UI・共有処理・DB・E2E本体の変更はブラウザー全件、依存関係・build/CI設定・インフラ・検証スクリプトの変更はAlchemy CLIと開発サーバーを含む全件を実行する。開発テストの変更でも開発サーバー検証を実行する。それ以外の通常の機能変更ではAlchemy CLIと開発サーバー検証を省略する。

選択の正本は `app/scripts/verification-plan.mjs` とE2Eのタグ。PR baseからHEADまでの差分を使い、renameは移動前後のパスを判定する。未分類のパスや新機能、差分取得失敗は全件に戻す。選択ロジックのNodeテストも毎回実行し、選択理由・対象タグ・省略項目を `app/test-results/local-verification.json` に残す。省略は `not_selected` と記録し、成功と区別する。`test:local` とActionsの `workflow_dispatch` は常に全件を実行する。

必須ジョブ名 `cloudflare-quality` は維持し、workflowのパスフィルターは使わない。同じPRの古いCIは新しい実行でキャンセルし、ジョブ上限は20分とする。`setup-bun` はCI/CDとも `no-cache: true` としてBun実行ファイルのキャッシュ保存を行わない。依存インストールは従来どおりlockfile固定で行い、本番配備の実行中キャンセルは無効のままとする。

Cloudflare公式pluginによる `vp build` と `vp preview` を使用する。build時は実資格情報だけでなくテスト用 `.dev.vars` も用意せず、CD同様に秘密値なしでSPA shellを生成する。build後に入口・assetsディレクトリ・PWAのshell登録を確認し、テスト用認証設定を追加してD1/E2Eを行う。Alchemyの内部APIや別プラグインによる代替buildは使用しない。本番はAlchemyの公開 `Worker` APIでこの形式の生成物を再bundleせず配備する。本番binding・権限・公開ドメイン・リソース更新はCDで別途確認する。

DB統合テストのfixtureはWranglerの `getPlatformProxy` で実際のD1 bindingを起動し、初期SQLを適用する。DB制約によるbatch全体のrollback、同時完了の回数上下限、同時初期登録、チーム移動、締めの冪等性を確認する。D1に未対応の対話的transactionや、DBをmockしたテストで代替しない。

ブラウザーテストはpreviewと同じ一時D1を使用する。fixture用D1接続は初期データ投入直後に閉じ、ブラウザー操作中はpreview WorkerだけがDBを利用する。保存結果は更新応答を待った後の画面再読込で確認し、別エミュレーターによる同時SQL pollingを行わない。Googleとの実通信は行わず、テスト専用セッションを登録してWorkerの認証・Server Functions・業務DBを通す。`test:dev` は5195で実際の開発サーバーを起動し、未ログイン表示とリロード安定性を確認する。3回の自動リロードでブラウザーを閉じ、負荷を制限する。

Google実OAuth、Cloudflare本番D1の性能・権限、iPhone実機Pushは配備環境で別途確認する。ローカルエミュレーションを本番・実機確認として報告しない。

ユーザーschemaの整理では、適用前のD1に所属・担当・完了履歴・Push配信記録・セッションを用意してmigration後の保持を検証する。Better Authのupdate-userへのnickname/colorHex入力拒否、認証側の名前変更の即時反映、同時初回ログインでの初期チーム重複防止、OAuth state/レート制限テーブルの実利用も確認する。

本番配備の回帰検証では、production以外のstageの拒否と配備設定を確認する。workflowの構文はactionlintで検証する。CDはbuild・設定検証・bootstrap・plan・deployの失敗で停止する。旧スキーマがある場合は、新Workerの `/health` でrelease一致を確認してから削除migrationへ進む。実Cloudflareへのplan/deployはローカルテストでは実行しない。

## 登録制限・認証境界

`tests/server/auth-access.test.ts` は実D1とBetter AuthのOAuth保存処理で、許可外/類似メールの拒否とDB無変更、許可メールの正規化、既存ユーザーの再ログイン、同じメールを使う別Google subjectの連結拒否を検証する。未確認メール、password認証の無効化、期限切れ/失効/改ざんセッション、認証のorigin/redirect制約も確認する。Googleによる署名検証・実OAuthは別途必要で、fixtureがそこを検証したとは扱わない。

登録制限は常時有効とする。設定不足を503にし、旧SIGNUP_GUARD_ENABLED=falseを残しても制限が解除されないことを検証する。Better Authのテスト環境の既定値に依存せず、origin/CSRFチェックを明示的に有効にして本番と同じ条件で試験する。

Git除外には環境ファイル・状態・DB・鍵・HAR・SQLダンプを含め、app/migrationsのSQLと設定例はGit管理する。Gitleaks等によるファイル/履歴スキャンはignoreテストとは別に実施し、機密値を出力せず、検出したサンプル値と実際の漏えいを区別する。

## Drizzle / D1

`task-requirements.test.ts` は回数の増減・1〜7回、JST週境界、月またぎ、予定の再編集/取消、同時更新/完了上限、過去完了の修正と締め済み集計の保持、日間の1回固定、Pushの必要回数、失敗時のrollbackを実D1で検証する。`team-access.test.ts` の認可マトリクスにも回数変更と履歴テーブルを含める。UIでは編集初期値、失敗時の入力保持、再編集、名前/メモのみの保存、予約取消を確認する。desktop/mobileのE2Eでは週3回完了後に週1回を予約し、再読込後の適用日表示と今週の3回完了の保持を確認する。

`drizzle-schema.test.ts` は全テーブルのDrizzle定義とmigration適用後の列・型・null制約・主キー・外部キーを照合する。`d1-atomic.test.ts` は実際のD1 batch rollback、同時加減算・完了、部分更新、締めを検証する。ApplicationのRepository portへDrizzle型を漏らさない。

`migration-0014.test.ts` は廃止前のD1にデータを入れてから、ToDo・MCP認可・音声利用枠・ToDo設定を削除し、認証・チーム・家事・共有ページのデータと外部キーを保持することを確認する。

`migration-0015.test.ts` は共有ページの本文と作成記録のあるD1を更新し、両テーブルと索引の削除、チーム所属と外部キーの整合性を確認する。

`summary.test.ts` は複数家事・日付・週・チームを混在させ、ホーム/月次集計の完了が混ざらないこと、完了者がNULLでも完了状態を保持すること、月またぎ週を終了月へ表示することを実D1で確認する。不正な集計DTOは共通clientのテストで拒否を確認し、画面側の空一覧への変換で隠さない。

## 日本時間と端末タイムゾーン

業務日付はJST、保存する時刻はUTCのISO 8601文字列、対象日・対象月は日付文字列として扱う。ブラウザーやコンテナの既定timezoneに依存させない。日付のみの計算にはUTCフィールドを用い、現在時刻を日付に変換するときはAsia/Tokyoを明示する。

`tests/e2e/application.spec.ts` はUTC・Los Angeles・Aucklandのブラウザーで、UTCと日本で日付・月が異なる時刻のヘッダー・集計月・カレンダーの今日とセルを確認する。日付utilityと招待期限のテストは `TZ=UTC` / `TZ=America/Los_Angeles` / `TZ=Pacific/Auckland` を付けたVitestでも実行できる。これはテスト時の環境変更で、配備にTZ環境変数を要求するものではない。カレンダーと集計画面では、存在しない日付やAPIの対象外の月がURLに指定された場合に、日本時間の今日・当月へ戻ることを画面と先読みの両方で確認する。

`user-schema.test.ts` は0001→0002→0003→0004でrevision列/テーブルを撤去し、業務データを保持すること、認証日時・nullable期限・Push配信日時のISO変換とミリ秒精度を検証する。セッション期限での絞り込み、期限切れOAuth stateの削除、rate limitの加算・429・期間経過後の解除も実Better Auth/D1で確認する。`push.test.ts` はISO形式のlease比較・再取得・成功後再送抑止を検証する。

## サマリーの過去タスク操作

日間・週1回は描画前の二重クリックでも1回しか送信せず、週複数回は保存応答前の連続タップと描画前の上限・下限を検証する。完了表示と自分のアイコンの即時反映、項目横の「保存中…」非表示、日間/週間ボタンのフォーカス維持も確認する。保留したPromiseで成功応答順の逆転、一部失敗時の他メンバー・成功した操作の保持、古い取得結果への楽観表示の重ね合わせ、対象月を往復した場合の表示と保存先を検証する。PCのE2EではTab/Enterだけで週間3回分を登録できることを確認する。

日間の完了/未完了、週間の加算/減算で、確認モーダルやカウントダウンなしで押下時にAPIを呼ぶことを確認する。fake timerを進めずにAPI呼び出しを検証し、3秒待機が再導入される回帰を防ぐ。同一タスクの別日付の独立性、通信失敗後の復帰、締め済み月の再計算案内、月次締め自体の確認モーダルも検証する。実D1のPC/モバイルE2Eで、対象月を移動した後の元の日付への保存、週間3回の加算と減算、再読込後の状態を確認する。追加のE2Eでは日間1回・週間3回の保存リクエストを保留して即時表示を確認し、週間の1件だけ通信失敗にして残り3件の保存と再読込後の保持を検証する。

## 操作速度と取得効率

`repository-performance.test.ts` は使い捨てD1へ700件の週次設定履歴を入れ、現在表示の2件・Push/過去操作の1件・月次範囲への取得制限と、全履歴と同じ必要回数を確認する。800件の日間家事の並べ替えでは実SQLの`EXPLAIN QUERY PLAN`で要求IDの単回展開と索引検索を確認し、重複IDの拒否と無変更も検証する。実行時間の固定閾値や本番の改善率には換算しない。

ホームと集計の完了hookは多数のpending操作で対象IDの参照回数が線形になること、週間の交互の加算/減算と完了者、無関係な項目・グループの参照保持を検証する。家事の並べ替えは保存失敗後の表示復元、再mount時のpending共有、同一描画内の重複送信抑止、遅い応答による編集の巻戻し・削除済み項目の復活を検証する。

`jobs.test.ts`は締めの通知を変更チームごとに1回へまとめること、途中失敗時の保存済み変更と他チームの処理継続を確認する。Pushは保留した送信Promiseで最大4件の並列上限と、遅い送信先があっても後続が進むこと、claim・送信・完了の失敗隔離を確認する。

`scripts/check-architecture.test.mjs`は`.ts`のジェネリクスと`.tsx`のJSX、type-only import、再export、動的import、featureの全内部層を確認する。一括検証は検証選択のNodeテストと併せて実行する。

性能回帰は表示の正しさに加え、未変更のqueryデータ・一覧部分の参照保持、同一データの再取得や別タブ設定変更で不要なcommitが発生しないこと、重複presenceで接続UIを更新しないことを確認する。React Compilerを有効にした構成を維持し、手動memoの一律追加は行わない。招待期限のタイマーは期限到達時の更新と後片付け、集計は対象月・対象項目だけへのpending操作適用を確認する。

`domain.test.ts` と `reminder-period.test.ts` は予定取得の366日（うるう年を含む）を許可し、367日・逆順・極端な長期間を拒否すること、期間補正やRepository呼出より前に拒否することを確認する。HTTPテストでは本文の実バイト数で上限を検査し、Content-Lengthなし・過少申告・ストリーム障害・正当な本文の引継ぎを確認する。依存監査は既知の脆弱性データベースを対象とし、未公開の脆弱性がないことの証明とは扱わない。

年0000、翌月境界が範囲外になる9999年12月、4桁年を越える日付演算を拒否し、9999年12月31日を含む繰り返し予定が終了することを検証する。招待の最大有効期間30日はブラウザータイマー上限を越えるため、分割待機でも早期失効・連続再描画が起きないことを確認する。

`operation-access.test.ts` は実Better AuthとD1を使い、session/userのJOIN取得が1回、正常な `getMe` 全体の照会が4回であること、日時のDate型保持と削除後の再照会、認証失効・未所属・別本人・固定済み所属の移動を1つの所属解決SQLでも拒否することを確認する。処理後の失効・所属移動の拒否と、認可された空一覧の正常応答を区別する。照会数は実fixtureのstatement数であり、本番の応答時間や改善率ではない。

`App.test.tsx` は起動時に全画面コードやホーム外のホームデータを先読みしないこと、認証後に現在画面とsearchに対応する取得を開始すること、操作時の先読みと失敗後の再試行を確認する。`route-preload.test.ts` は画面moduleの読み込み待ちを挟まない並列取得、URLの集計月・予定日、実行中通信と新鮮なキャッシュの共有、先読み失敗後の再試行、キャンセル後の旧データ破棄、ログアウト・所属変更後の旧データ破棄を確認する。カレンダーのhookテストは定義の応答を保留しても発生日取得が始まること、月移動時に直前の結果を保持することを確認する。`teamStateRefresh.test.ts` と `useTeamRealtime.test.tsx` は変更範囲外のQueryを無効化しないこと、通知範囲の重複除去、保存中の集約、旧形式と再接続時の全体同期を確認する。サーバー側はoperationと通知範囲の網羅、D1保存後の通知、認可済み接続だけへの範囲付き配信を検証する。

`reminder-period.test.ts` は実D1で期間に重ならない予定の除外、開始/終了日の包含、期限切れ単発予定と繰り返し予定の区別、別チーム分離を確認する。取得行数の減少は検証するが、本番D1のレイテンシ改善率としては扱わない。

## 表示モード

フォーカス時は全体のoutlineを共通CSSで無効化し、focus専用のring・border色変更を追加しない。E2Eでdesktop/mobile・light/darkのログイン、設定入力と選択済みテーマをフォーカスし、通常の境界線・カードのring・影が維持され、追加の枠が出ないことを確認する。

`ThemeSettings.test.tsx` は初期システム設定、明示選択と再mount、OS変更、別タブ変更/削除/clear、不正保存値、storage例外、保存失敗後の現在値維持と再試行、SSRでの未読込と購読解除を検証する。headスクリプトとReactの初期化結果も比較する。

E2Eの `@theme` はdesktop/mobileでOS追従、明示ライト/ダーク、再読込、別タブ同期、ログインと主要全画面・カレンダー・フォームの配色を確認し画像を保存する。外部JavaScriptを遮断しても保存済みモードが起動表示へ適用されることを確認する。CSSだけの変更にAPI/DBの新規テストは追加しない。iPhone実機Safari/PWAのOSスプラッシュ表示はローカルChromium検証に含めない。
