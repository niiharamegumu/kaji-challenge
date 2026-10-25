# テスト方針

挙動を観測できる最小の層で検証します。実DBテストのskipを成功として報告しません。

- UI: Vitest/Testing Libraryで表示・操作・loading/empty/errorを検証します。mockはfeature API adapterの境界に置きます。
- 設定画面ではヘッダーのメンバーキャッシュ再利用、プロフィール保存中の操作抑止、失敗時の入力保持・再試行、同名の別チームへ移動した際のdraft分離を確認します。
- Domain: 日付境界、月またぎ週、完了規則、予定を決定的なfixtureで検証します。`app/tests/fixtures/domain-scenarios.json` は業務規則の期待値です。
- Application/DB: 認可、チーム越境、競合とrollback、締めの冪等性、認証失効・セッション数を使い捨てのローカルD1で検証します。
- `team-access.test.ts` は全業務Repositoryのread/list/create/update/deleteを他チーム・所属移動/削除・セッション失効/期限切れで確認します。通常入口の偽装IDとSQLの対応は [authorization.md](authorization.md) を参照します。存在しないカテゴリーの削除も404とし、他チームIDで成功を装わないことを確認します。
- API契約: Zod入出力・DTOを正本とし、意図を指定した完了操作と、revisionを含まないtransport/adapterを確認します。
- 通信: 所属変更・ログアウト時の古い通信の破棄、更新失敗時の再取得、オフライン更新の自動再送抑止を確認します。
- 操作フィードバック: 遅延中の家事・ToDoの完了表示、失敗した操作だけの復元、週次連続3タップ、フォームの入力保持を確認します。
- Transport/DB: 入力不正・未認証・異なるOriginを拒否します。用途別D1 batchの制約違反は全体rollbackします。出力DTO検証は保存後であるため、検証失敗時もcommit済みデータは残ることを明示的に検証します。
- リアルタイム: 認証済みユーザーからのチーム選択、Origin拒否、失効・期限切れ・脱退接続への配信停止、複数タブの重複排除、attachmentからのインスタンス復元、未検証接続への配信拒否、attachment不正・復元失敗を検証します。後者はHibernation APIの契約を模した単体テストであり、実Cloudflareの休止スケジューリングを再現したものではありません。
- 接続UI: 切断時の古いpresence破棄・メンバーの常時表示・接続確認中への切替、再接続・Query再取得、mutation中の通知集約、画面遷移での接続維持を検証します。実WorkersのE2Eで2ユーザー間の家事完了/取消・ToDo完了、アイコンの接続中/未接続切替とチーム分離を確認します。
- ブラウザー: Workers previewとローカルD1を使い、desktop/mobileで画面遷移、保存、ドラッグ、戻る操作、PWA offline shellを確認します。
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

PRのCIは `test:ci` で、format・build・型・lint・境界・UI全件・server/DB/認証全件を毎回検証する。ブラウザーはdesktop/mobileのログイン入口・主要画面遷移・ToDo保存を `@smoke` として毎回実行し、変更した機能のタグを追加する。認証・共通UI・共有処理・DB・E2E本体の変更はブラウザー全件、依存関係・build/CI設定・インフラ・検証スクリプトの変更はAlchemy CLIと開発サーバーを含む全件を実行する。開発テストの変更でも開発サーバー検証を実行する。それ以外の通常の機能変更ではAlchemy CLIと開発サーバー検証を省略する。

選択の正本は `app/scripts/verification-plan.mjs` とE2Eのタグ。PR baseからHEADまでの差分を使い、renameは移動前後のパスを判定する。未分類のパスや新機能、差分取得失敗は全件に戻す。選択ロジックのNodeテストも毎回実行し、選択理由・対象タグ・省略項目を `app/test-results/local-verification.json` に残す。省略は `not_selected` と記録し、成功と区別する。`test:local` とActionsの `workflow_dispatch` は常に全件を実行する。

必須ジョブ名 `cloudflare-quality` は維持し、workflowのパスフィルターは使わない。同じPRの古いCIは新しい実行でキャンセルし、ジョブ上限は20分とする。`setup-bun` はCI/CDとも `no-cache: true` としてBun実行ファイルのキャッシュ保存を行わない。依存インストールは従来どおりlockfile固定で行い、本番配備の実行中キャンセルは無効のままとする。

Cloudflare公式pluginによる `vp build` と `vp preview` を使用する。build時は実資格情報だけでなくテスト用 `.dev.vars` も用意せず、CD同様に秘密値なしでSPA shellを生成する。build後に入口・assetsディレクトリ・PWAのshell登録を確認し、テスト用認証設定を追加してD1/E2Eを行う。Alchemyの内部APIや別プラグインによる代替buildは使用しない。本番はAlchemyの公開 `Worker` APIでこの形式の生成物を再bundleせず配備する。本番binding・権限・公開ドメイン・リソース更新はCDで別途確認する。

DB統合テストのfixtureはWranglerの `getPlatformProxy` で実際のD1 bindingを起動し、初期SQLを適用する。DB制約によるbatch全体のrollback、同時完了の回数上下限、同時初期登録、チーム移動、締めの冪等性を確認する。D1に未対応の対話的transactionや、DBをmockしたテストで代替しない。

ブラウザーテストはpreviewと同じ一時D1を使用する。fixture用D1接続は初期データ投入直後に閉じ、ブラウザー操作中はpreview WorkerだけがDBを利用する。保存結果は更新応答を待った後の画面再読込で確認し、別エミュレーターによる同時SQL pollingを行わない。Googleとの実通信は行わず、テスト専用セッションを登録してWorkerの認証・Server Functions・業務DBを通す。`test:dev` は5195で実際の開発サーバーを起動し、未ログイン表示とリロード安定性を確認する。3回の自動リロードでブラウザーを閉じ、負荷を制限する。

Google実OAuth、Cloudflare本番D1の性能・権限、iPhone実機Pushは配備環境で別途確認する。ローカルエミュレーションを本番・実機確認として報告しない。

ユーザーschemaの整理では、適用前のD1に所属・担当・完了履歴・Push配信記録・セッションを用意してmigration後の保持を検証する。Better Authのupdate-userへのnickname/colorHex入力拒否、認証側の名前変更の即時反映、同時初回ログインでの初期チーム重複防止、OAuth state/レート制限テーブルの実利用も確認する。

本番配備の回帰検証では、production以外のstageの拒否と配備設定を確認する。workflowの構文はactionlintで検証する。CDはbuild・設定検証・bootstrap・plan・deployの失敗で停止し、配備後のHTTP疎通・release一致は検証しない。実Cloudflareへのplan/deployはローカルテストでは実行しない。

## 登録制限・認証境界

`tests/server/auth-access.test.ts` は実D1とBetter AuthのOAuth保存処理で、許可外/類似メールの拒否とDB無変更、許可メールの正規化、既存ユーザーの再ログイン、同じメールを使う別Google subjectの連結拒否を検証する。未確認メール、password認証の無効化、期限切れ/失効/改ざんセッション、認証のorigin/redirect制約も確認する。Googleによる署名検証・実OAuthは別途必要で、fixtureがそこを検証したとは扱わない。

登録制限は常時有効とする。設定不足を503にし、旧SIGNUP_GUARD_ENABLED=falseを残しても制限が解除されないことを検証する。Better Authのテスト環境の既定値に依存せず、origin/CSRFチェックを明示的に有効にして本番と同じ条件で試験する。

Git除外には環境ファイル・状態・DB・鍵・HAR・SQLダンプを含め、app/migrationsのSQLと設定例はGit管理する。Gitleaks等によるファイル/履歴スキャンはignoreテストとは別に実施し、機密値を出力せず、検出したサンプル値と実際の漏えいを区別する。

## Drizzle / D1

`task-requirements.test.ts` は回数の増減・1〜7回、JST週境界、月またぎ、予定の再編集/取消、同時更新/完了上限、過去完了の修正と締め済み集計の保持、日間の1回固定、Pushの必要回数、失敗時のrollbackを実D1で検証する。`team-access.test.ts` の認可マトリクスにも回数変更と履歴テーブルを含める。UIでは編集初期値、失敗時の入力保持、再編集、名前/メモのみの保存、予約取消を確認する。desktop/mobileのE2Eでは週3回完了後に週1回を予約し、再読込後の適用日表示と今週の3回完了の保持を確認する。

`drizzle-schema.test.ts` は全テーブルのDrizzle定義とmigration適用後の列・型・null制約・主キー・外部キーを照合する。`d1-atomic.test.ts` は実際のD1 batch rollback、同時加減算・完了、部分更新、締めを検証する。ApplicationのRepository portへDrizzle型を漏らさない。

`summary.test.ts` は複数家事・日付・週・チームを混在させ、ホーム/月次集計の完了が混ざらないこと、完了者がNULLでも完了状態を保持すること、月またぎ週を終了月へ表示することを実D1で確認する。不正な集計DTOは共通clientのテストで拒否を確認し、画面側の空一覧への変換で隠さない。

## 日本時間と端末タイムゾーン

業務日付はJST、保存する時刻はUTCのISO 8601文字列、対象日・対象月は日付文字列として扱う。ブラウザーやコンテナの既定timezoneに依存させない。日付のみの計算にはUTCフィールドを用い、現在時刻を日付に変換するときはAsia/Tokyoを明示する。

`tests/e2e/application.spec.ts` はUTC・Los Angeles・Aucklandのブラウザーで、UTCと日本で日付・月が異なる時刻のヘッダー・集計月・カレンダーの今日とセルを確認する。日付utilityと招待期限のテストは `TZ=UTC` / `TZ=America/Los_Angeles` / `TZ=Pacific/Auckland` を付けたVitestでも実行できる。これはテスト時の環境変更で、配備にTZ環境変数を要求するものではない。

`user-schema.test.ts` は0001→0002→0003→0004でrevision列/テーブルを撤去し、0005でToDoへ移行し、業務データを保持すること、認証日時・nullable期限・Push配信日時のISO変換とミリ秒精度を検証する。セッション期限での絞り込み、期限切れOAuth stateの削除、rate limitの加算・429・期間経過後の解除も実Better Auth/D1で確認する。`push.test.ts` はISO形式のlease比較・再取得・成功後再送抑止を検証する。

## サマリーの過去タスク操作

日間・週1回は描画前の二重クリックでも1回しか送信せず、週複数回は保存応答前の連続タップと描画前の上限・下限を検証する。完了表示と自分のアイコンの即時反映、項目横の「保存中…」非表示、日間/週間ボタンのフォーカス維持も確認する。保留したPromiseで成功応答順の逆転、一部失敗時の他メンバー・成功した操作の保持、古い取得結果への楽観表示の重ね合わせ、対象月を往復した場合の表示と保存先を検証する。PCのE2EではTab/Enterだけで週間3回分を登録できることを確認する。ToDo連続追加ではEnter直後に通常追加ボタンが押された場合も二重登録・意図しないフォーム閉鎖を防ぐ。

日間の完了/未完了、週間の加算/減算で、確認モーダルやカウントダウンなしで押下時にAPIを呼ぶことを確認する。fake timerを進めずにAPI呼び出しを検証し、3秒待機が再導入される回帰を防ぐ。同一タスクの別日付の独立性、通信失敗後の復帰、締め済み月の再計算案内、月次締め自体の確認モーダルも検証する。実D1のPC/モバイルE2Eで、対象月を移動した後の元の日付への保存、週間3回の加算と減算、再読込後の状態を確認する。追加のE2Eでは日間1回・週間3回の保存リクエストを保留して即時表示を確認し、週間の1件だけ通信失敗にして残り3件の保存と再読込後の保持を検証する。

## ToDo移行とカテゴリー

ToDo完了の取り消しはfake timerで2999ms時点の未実行と3000ms時点の1回実行、期限直前の取り消し・再予約、複数件の独立性、重複予約、画面相当の子要素変更後の実行/取り消し、providerの破棄・ユーザー/チーム切り替え・StrictModeでのタイマー破棄を確認する。画面テストでは確認モーダルの廃止、項目内の円形カウントダウン（3→2→1）と取り消し、下部バナーの非表示、待機中の編集・ドラッグ抑止、送信失敗後の復元、成功Toastの「ToDoを完了しました」を検証する。E2EではホームとToDo画面での取り消し/確定、3秒を超えても取り消した操作を送信しないこと、画面遷移をまたぐ確定、再読込後の保持/削除と別メンバーへの同期を確認する。

取消猶予のブラウザー設定は、初期3秒と1〜5秒の5つの選択肢、整数msの保存と再mount時の復元を設定コンポーネントで確認する。旧保存値（100〜5000msの100ms倍数）は最も近い整数秒へ丸め、下限1秒へ補正する。丸め境界・型・範囲・壊れたJSON・storageの取得/読み書き例外、SSRでstorageに触れないこととhydration一致、別タブの更新/clearも確認する。providerでは設定した期限直前と期限での1回実行、同一描画前の設定変更・重複予約、1秒の取消と再予約、画面をまたぐ設定変更で既存予約の期限・円の割合を維持することを検証する。API失敗後の復元は1・3・5秒で確認する。標準E2Eのdesktop/mobile ChromiumではPlaywrightのselectOptionで選択操作を確認し、desktopではTab/Shift+Tabによる選択欄へのフォーカス移動も確認する。OSネイティブメニュー内のキー選択はこの自動検証に含めない。両環境で旧保存値の復元、再読込保持、別ブラウザープロファイルへの非共有、5秒の取消、1秒設定でホーム/ToDoの完了と再読込後の削除、横はみ出しがないことを確認し、設定画面の画像を保存する。DB/API/schemaは変更しないため設定専用のserver/契約テストは追加しない。

カテゴリーの横スワイプはUIで左右の切り替え、保存順（未分類を含む）、空カテゴリー、先頭/末尾、タップ併用、追加フォームへの選択反映を確認する。ジェスチャー単体では短い移動・縦/斜め移動・縦から横への方向変更・中断・複数指・マウス選択・操作部品からの開始を除外することを検証する。E2Eでは独立したユーザーと実タッチ入力を使い、ホーム・ToDoの1件/0件で表示内容の下の余白を開始点にして切り替えられることを確認する。ToDoページは追加ボタンの上まで広がる余白を使い、elementFromPointで開始点が操作領域に含まれることも確認する。スクロール可能なホームの余白では縦スクロールを維持することを確認する。モバイルE2Eでは両画面の切り替え、タブ列の横スクロール、選択タブの可視性、並べ替えの維持も確認する。iPhone実機Safariの検証とは扱わない。

`tests/server/todos.test.ts`は旧買い物テーブルからのデータ保持・テーブル数不変・既存項目の未分類と空のカテゴリー一覧、カテゴリー管理での登録・0件保持・削除時の未分類化、完了時の物理削除、チーム分離、並行登録、失敗時のbatch rollback、入力制限を実D1で検証する。ToDo画面テストでは登録済みカテゴリーの選択、候補がない場合の未分類、候補の初回取得待ち・失敗からの再試行、追加/編集の入力中にカテゴリーが削除された際の未分類化と他の入力保持、同名再登録時のフィルター解除維持、編集でのカテゴリー解除、絞り込み、カテゴリーの追加・削除と保存失敗時の入力保持を確認する。E2Eでは「その他」からカテゴリー管理への遷移、ToDoへ戻った際の反映、ホームとToDo両画面での絞り込み・非表示項目の位置を保つ並べ替え、スマートフォンでのフィルター横スクロールとページ全体に横はみ出しがないことを確認する。

カテゴリー順序は`todo-category-order.test.ts`で0005→0006のデータ保持、未分類の先頭/途中/末尾、追加・削除後の相対順序、SQL内の所属検査、チーム分離、並行追加・削除、古い集合の拒否、nullちょうど1件と重複禁止を実D1/契約で検証する。UIでは保存中の操作抑止・保存失敗後の復元/再取得・入力保持、タブ/選択欄の保存順序を確認する。E2Eではマウス、モバイルの長押しタッチ、キーボードでの並べ替えと、リロード後の管理画面/ホーム/ToDo/選択欄への反映を検証する。タッチ検証はChromiumの端末エミュレーションでありiPhone実機Safariではない。

固定ID化は、別チーム/削除済みIDのToDo保存拒否（既存行・並び順を変更しない）、カテゴリー削除とToDo保存の競合、同名再作成での自動再紐付け禁止をDBで確認する。名前変更APIで更新した後もID・ToDo参照・順序が保持され、古いID配列による並べ替えが現在の名前を維持することをDBで確認する。同名への変更拒否、削除済み/別チームIDの拒否、所属失効、並行追加・削除・並べ替え・同名への更新競合、入力制限も検証する。UIでは編集モーダルの初期値、保存中の操作抑止、失敗時の入力保持、閉じて別カテゴリーを開いた際の初期化、選択とフィルターのID維持を確認する。E2Eでは名前変更後に再読込し、ホーム/ToDoに新しい名前が反映されて既存ToDoを絞り込めることを確認する。

`todo-category-conversion.test.ts` は手動変換のdry-run、未分類位置の保持、名前・メモ・日時・ToDo参照の保持、変換前後の再実行、0005での実行、不整合拒否、D1 batch rollback、0007適用後の列・外部キーを使い捨てD1で確認する。実本番DBへの手動変換はCIやPR作成時には実行しない。

ToDo初期カテゴリーの設定はUIで保存/再mount、未分類とすべての区別、表示順の維持、名前変更/削除、ユーザー・チーム分離、遅いカテゴリー取得、手動選択の維持、不正な保存値、storage例外、SSRでの未読込、別タブの変更を確認する。E2Eではdesktop/mobileで設定を再読込して保持し、ホーム/ToDoの初期表示、SPA遷移と再読込後の再適用、タブ順の維持を検証する。DB/APIは変更しないためserverテストは追加しない。

## 操作速度と取得効率

性能回帰は表示の正しさに加え、未変更のqueryデータ・一覧部分の参照保持、同一データの再取得や別タブ設定変更で不要なcommitが発生しないこと、重複presenceで接続UIを更新しないことを確認する。React Compilerを有効にした構成を維持し、手動memoの一律追加は行わない。招待期限のタイマーは期限到達時の更新と後片付け、集計は対象月・対象項目だけへのpending操作適用を確認する。

`domain.test.ts` と `reminder-period.test.ts` は予定取得の366日（うるう年を含む）を許可し、367日・逆順・極端な長期間を拒否すること、期間補正やRepository呼出より前に拒否することを確認する。HTTP/MCPテストでは本文の実バイト数で上限を検査し、Content-Lengthなし・過少申告・ストリーム障害・正当な本文の引継ぎを確認する。依存監査は既知の脆弱性データベースを対象とし、未公開の脆弱性がないことの証明とは扱わない。

年0000、翌月境界が範囲外になる9999年12月、4桁年を越える日付演算を拒否し、9999年12月31日を含む繰り返し予定が終了することを検証する。招待の最大有効期間30日はブラウザータイマー上限を越えるため、分割待機でも早期失効・連続再描画が起きないことを確認する。

`operation-access.test.ts` は実Better AuthとD1を使い、正常な `getMe` の照会が5回であること、認証失効・未所属・別本人・固定済み所属の移動を1つの所属解決SQLでも拒否することを確認する。処理後の失効・所属移動の拒否と、認可された空一覧の正常応答を区別する。照会数は実fixtureのstatement数であり、本番の応答時間や改善率ではない。

`App.test.tsx` は起動時に全画面コードやホーム外のホームデータを先読みしないこと、操作時の先読みと失敗後の再試行を確認する。`route-preload.test.ts` は遷移前の並列取得、実行中通信と新鮮なキャッシュの共有、先読み失敗後の再試行、キャンセル後の旧データ破棄、コード取得中のログアウト・所属変更後に新しい取得を始めないことを確認する。`teamStateRefresh.test.ts` と `useTeamRealtime.test.tsx` はToDo変更時に無関係なQueryを無効化しないこと、通知範囲の重複除去、保存中の集約、旧形式と再接続時の全体同期を確認する。サーバー側はoperationと通知範囲の網羅、D1保存後の通知、認可済み接続だけへの範囲付き配信を検証する。

`todoFeedback.test.tsx` は応答前の編集/並べ替え、画面の再mountでの共有、部分失敗、別操作の追加/編集/完了を遅い並べ替え応答で消さないことを確認する。E2Eでは保存リクエストを保留した状態でToDoからホームへ移動し、順序の即時共有・失敗後の復元・再試行とリロード後の保存をdesktop/mobileで検証する。

`reminder-period.test.ts` は実D1で期間に重ならない予定の除外、開始/終了日の包含、期限切れ単発予定と繰り返し予定の区別、別チーム分離を確認する。取得行数の減少は検証するが、本番D1のレイテンシ改善率としては扱わない。


## MCP / OAuth / Workers RPC

`mcp-connections.test.ts` は実D1で単回同意・grant結合・本人限定の失効・期限・FKを検証する。`mcp-operations.test.ts` と `todo-access.test.ts` は現在所属、他チームID、scope、SQL直前の解除、既存ToDo処理の再利用を確認する。`update_todo` は省略とnullの区別、名前/メモの境界、未知キー・空更新、同チームの別メンバーの更新、他チームToDo/カテゴリー・削除されたカテゴリーの拒否とDB無変更を検証する。入口と共有Applicationの間の所属変更、SQL直前の失効・所属変更、保存後に期限を迎えた更新を再送しないことも確認する。

期限の検証はexpiry列の書換えだけに依存しない。`mcp-operations.test.ts` / `team-access.test.ts` はfake DateによるApplicationのawait中・応答前の失効と、実D1時計を使ったSQL構築後の自然失効を分けて検証する。同意claim・session・grant結合も実時計で確認する。fake timerはD1の時計を動かさない。長時間batch内の時刻変化と保存後の失効の限界は [authorization.md](authorization.md) に記録する。

`mcp-oauth.test.ts` は実provider・KV・D1とテスト専用Better Authセッションで、S256、resource、同意scope縮小、CSRF、セッション・policy結合、code再利用、7日の上限とD1残期限、refresh非発行・旧refresh拒否・解除を検証する。旧15分tokenが新同意でも延長されず、旧画面・未交換コードが拒否されることも確認する。SDKの整数秒境界とアプリの期限ちょうどの拒否を区別し、保存値を変えずに時計を進める。実Google OAuthやChatGPTの7日間の接続維持は検証しない。`mcp-worker.test.ts` は実SDKのHTTP要求で4ツール・厳密な入力・scope challenge・並行利用者の分離・本文制限を検証する。

サーバーアイコンはlegacy initializeと現行server/discoverの標準metadata、認証不要のGET/HEAD、元PNGとのbytes一致、Origin/Host/メソッド制限を確認する。`mcp-consent-csp.spec.ts` は外部通信を遮断したChromiumでdesktop/mobileの同意画面、320px幅と文字拡大、長い未信頼入力、キーボードによるscope縮小、native formの送信値とCSPを検証し、表示画像を保存する。クライアントの実アイコン表示やiPhone実機Safariの確認とは扱わない。

`mcp-workers.test.ts` は2つの実workerd Workerとnamed Service Bindingを使い、OAuthからMCP読み書き・解除までを隔離D1/KVで確認する。外部通信と本番の認証情報を使用しない。全体 `test:local` では既存アプリのMCP設定を無効にし、buildにMCP bundleとnamed exportが含まれ、MCP側にDB/KV/秘密情報がbindされないことも確認する。

MCP停止は `infra.test.ts` で有効/無効/再有効化のWorker構成とKV保持、通常Application・D1構成の維持を確認する。`mcp-worker.test.ts` は無効・未設定・不正flagでhealth・アイコン・discovery・MCPをすべて拒否すること、maintenanceでは従来どおりhealthとアイコンを返すことを確認する。`mcp-oauth.test.ts` は無効時のOAuth・連携管理・discoveryと、発行済み有効tokenによる全named RPCツールの拒否を、DB/KV bindingがない状態で検証する。停止してもgrantを消去しないことも確認する。実Cloudflareの削除・Custom Domainの棚卸し、GitHub変数の変更、本番データ消去はローカル検証に含めない。

RFC 7009失効は新access/合成した旧refresh両方でD1先行を確認し、別client・不正tokenでD1が変わらないこと、D1障害時の503、KV削除障害後や切替前から進行中の旧refresh発行後もlist/add/update/completeと以後のrefreshが拒否されることを検証する。旧設定のSDKは既存テスト内にのみ置き、本番入口を追加・変更しない。障害注入はテストfixtureに限定する。`check-oauth-provider-patch.mjs` はbuildと一括検証で依存versionとpatch登録を確認する。上流更新時の確認範囲は [mcp-oauth-provider-patch.md](mcp-oauth-provider-patch.md) を参照する。

実ChatGPT/Codex接続では先に公開先とOAuth権限の承認を得る。読み取り、承認済みテスト項目の追加、同じ項目だけの完了、解除後の拒否を順に確認し、サーバーのHTTP/認可失敗とクライアントプランの制約を分けて記録する。

## 常駐音声アシスト

複合指示は「塩は購入した、レモンを追加して」を回帰例にする。推論の成功出力は単独操作も配列形式に限定し、旧単独形式のprovider出力を拒否する。Applicationで両方の反映、順序付き検索、不足情報のある全体の保留、聞き返し中の完了指示の保持、未知カテゴリーでの全体無変更、操作数/合計件数/入れ子の拒否を確認する。`todo-mixed-batch.test.ts`とteam-accessマトリクスはSQL途中の制約違反で完了と並び順もrollbackすること、全体のカテゴリー条件、セッション/所属の失効、越境、同時実行を実D1で検証する。HTTPでは1推論・1通知で全結果を返すこと、ブラウザーでは完了と追加の結果が両方表示されることを確認する。

ToDo操作の拡張は `assist.test.ts` でカテゴリー候補の推論入力、登録先の実在検査、名前の正規化/部分一致とカテゴリー検索の組み合わせ、全同名の完了/削除、完全一致と部分一致の区別、未知カテゴリー、0件、推論中の失効を確認する。`todo-removal.test.ts` とteam-accessマトリクスは単一SQLの全件削除、カテゴリー/チーム/セッション境界、空集合、SQL風の名前、100件超の対象、同時削除の件数を実D1で確認する。HTTPテストでは検索/完了の契約・実保存・変更通知を確認する。ブラウザーでは「？」の開閉/Escape/再起動、320×480のヘルプ領域、20件超の件数案内、完了結果、縮小した画面と既存の録音/文字入力を確認する。AI fixtureは意味解釈精度の証明とせず、実AIでの自然な指示とカテゴリー推測は別途評価する。

文字起こし中はブラウザーで応答を保留し、通常停止では入力欄のスピナー、停止して送信では音声の仮メッセージと送信ボタンのスピナーを確認する。両方で操作抑止、読み上げ用の状態通知、完了後のアイコン消去を確認する。状態の文言は視覚上非表示にし、動きを減らす設定では回転を停止する。実AIの速度には依存させない。

録音開始はマイク許可を保留したままボタンの回転アイコンと準備状態を確認し、Workletの静的読み込みが許可待ちと並行することを検証する。「停止して送信」では停止応答前から送信準備状態へ進み、ASRを保留しても音声の仮メッセージ・処理中ドット・送信ボタンの回転アイコンが表示されることを確認する。実行応答も別に保留し、認識した全文への置換後も処理中表示を維持する。ASR失敗では仮表示を消し、下書きを保持して実行しない。通常停止の確認欄、文字数/時間上限、閉じた後の古い応答と単回送信も維持する。

state/DOMの更新だけではCPU処理中の描画を証明しない。音声のbase64化へ1秒のCPU負荷を入れ、即時ASR/LLM応答で送信準備中のボタンをrAFごとに観測する。同期変換の旧コードではASR前の観測が0frameになる回帰を確認し、専用Web Workerでは複数frameの更新を必須にする。WorkerのPCM転送・異常・期限・取消と、2frameの待機中に閉じた場合に後続処理を始めないことをunitで確認する。初期化は入力接続までresumeが完了しないfixtureを使い、最初のcontextで5秒期限を待たずに準備できることを確認する。実機Safariの入力状態・速度は別の受け入れ検証とする。

`assist.test.ts` / `assist-transport.test.ts` は実D1とfixture AIを使い、ASRだけでは保存しない・明示送信後の追加・一覧・聞き返し、AI待機中の所属固定と失効、不正WAV/未知キー/本文上限/Origin/頻度制限を検証する。フロントの音声ライフサイクルとブラウザー検証、最初の対象であるiPhone Safari/PWAの手動受け入れは [voice-assist.md](voice-assist.md) に記載する。通常の `test:local` はAI bindingなしで起動し、実推論を行わない。実AIの認識精度・速度・費用と端末のマイク/TTSは未検証の別項目として報告する。

`assist-budget.test.ts` は全体の60秒・UTC日・試用累計上限の同時予約と欠損時停止、`todo-batch.test.ts` は複数追加の全件保存/全件拒否・SQL時の認可・rollbackを検証する。`assist-ai.test.ts` はモデルと入力/出力の形式・上限・自動再送なしを検証する。

音声はASRと実行のHTTP入口を分け、両方で認証・Origin・所属・予算を検証する。50件/120秒/2,000文字の拡張境界と、50カテゴリーでのD1保存を確認する。Sessionとブラウザーでは手動録音・無音中の継続・通常停止の確認待ち・停止して送信・文字だけの入力・未送信破棄・反復起動を確認する。workletは最初の入力を処理してから開始応答を返し、重複開始でPCMを消さず、停止時の末尾PCMとsample数付きfinished応答を順に返すことを確認する。captureは開始応答の期限とsample数不一致で不完全な録音を送らないこと、35秒の音声の先頭/途中/末尾が残ることを検証する。ブラウザーは実AudioContext/AudioWorkletに3種類の合成トーンを通し、送信WAVの全区間・日本語全文の入力と送信までを確認する。文字起こし応答はfixtureであり、実ASRとiPhone Safariの入力品質は別の検証とする。320px幅/480px高でも主要操作が見えることを確認する。
