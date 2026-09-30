# テスト方針

挙動を観測できる最小の層で検証します。実DBテストのskipを成功として報告しません。

- UI: Vitest/Testing Libraryで表示・操作・loading/empty/errorを検証します。mockはfeature API adapterの境界に置きます。
- 設定画面ではヘッダーのメンバーキャッシュ再利用、プロフィール保存中の操作抑止、失敗時の入力保持・再試行、同名の別チームへ移動した際のdraft分離を確認します。
- Domain: 日付境界、月またぎ週、完了規則、予定を決定的なfixtureで検証します。`app/tests/fixtures/domain-scenarios.json` は業務規則の期待値です。
- Application/DB: 認可、チーム越境、競合とrollback、締めの冪等性、認証失効・セッション数を使い捨てのローカルD1で検証します。
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

## ローカル一括検証

ホストのNode.js・Bunは `mise.toml` で管理する。初回はリポジトリ直下で `mise trust && mise install` を実行し、`cd app && mise exec -- bun x --no-install playwright install chromium` でブラウザーを準備する。5194/5195ポートを空けて、`app/` で `mise exec -- bun run test:local` を実行する。miseをシェルで有効にしている場合は `mise exec --` を省略できる。Dockerや外部DBは不要。

一括検証は一時ディレクトリにソースをコピーし、テスト専用の認証設定とD1保存先を使う。普段の `.dev.vars` / `.env*` / `.wrangler` はコピーしない。終了時に一時DBを破棄し、成功・失敗結果とブラウザー証跡を `app/test-results/` に保存する。

Alchemyのbootstrap/plan/deployは `--help` でCLI起動を確認し、アプリのbuildだけでは検出できない実行時peer依存の欠落・RC版の不整合を検出する。`ALCHEMY_HOME` は一時ディレクトリへ向け、実資格情報の読み込みやクラウドへの配備を行わない。Effectとplatform-bun/platform-node、およびoverrideしたplatform-node-sharedは対応する同じRC版で更新する。

PRのCIは `test:local` で、Cloudflare公式pluginによる `vp build` と `vp preview` を検証する。build時は実資格情報だけでなくテスト用 `.dev.vars` も用意せず、CD同様に秘密値なしでSPA shellを生成する。build後に入口・assetsディレクトリ・PWAのshell登録を確認し、テスト用認証設定を追加してD1/E2Eを行う。Alchemyの内部APIや別プラグインによる代替buildは使用しない。本番はAlchemyの公開 `Worker` APIでこの形式の生成物を再bundleせず配備する。本番binding・権限・公開ドメイン・リソース更新はCDで別途確認する。

DB統合テストのfixtureはWranglerの `getPlatformProxy` で実際のD1 bindingを起動し、初期SQLを適用する。DB制約によるbatch全体のrollback、同時完了の回数上下限、同時初期登録、チーム移動、締めの冪等性を確認する。D1に未対応の対話的transactionや、DBをmockしたテストで代替しない。

ブラウザーテストはpreviewと同じ一時D1を使用する。fixture用D1接続は初期データ投入直後に閉じ、ブラウザー操作中はpreview WorkerだけがDBを利用する。保存結果は更新応答を待った後の画面再読込で確認し、別エミュレーターによる同時SQL pollingを行わない。Googleとの実通信は行わず、テスト専用セッションを登録してWorkerの認証・Server Functions・業務DBを通す。`test:dev` は5195で実際の開発サーバーを起動し、未ログイン表示とリロード安定性を確認する。3回の自動リロードでブラウザーを閉じ、負荷を制限する。

Google実OAuth、Cloudflare本番D1の性能・権限、iPhone実機Pushは配備環境で別途確認する。ローカルエミュレーションを本番・実機確認として報告しない。

ユーザーschemaの整理では、適用前のD1に所属・担当・完了履歴・Push配信記録・セッションを用意してmigration後の保持を検証する。Better Authのupdate-userへのnickname/colorHex入力拒否、認証側の名前変更の即時反映、同時初回ログインでの初期チーム重複防止、OAuth state/レート制限テーブルの実利用も確認する。

本番配備の回帰検証では、production以外のstageの拒否、healthの旧release・異常HTTP・不正JSON・接続失敗への再試行と上限を確認する。workflowの構文はactionlintで検証する。実Cloudflareへのplan/deployはローカルテストでは実行しない。

## 登録制限・認証境界

`tests/server/auth-access.test.ts` は実D1とBetter AuthのOAuth保存処理で、許可外/類似メールの拒否とDB無変更、許可メールの正規化、既存ユーザーの再ログイン、同じメールを使う別Google subjectの連結拒否を検証する。未確認メール、password認証の無効化、期限切れ/失効/改ざんセッション、認証のorigin/redirect制約も確認する。Googleによる署名検証・実OAuthは別途必要で、fixtureがそこを検証したとは扱わない。

登録制限は常時有効とする。設定不足を503にし、旧SIGNUP_GUARD_ENABLED=falseを残しても制限が解除されないことを検証する。Better Authのテスト環境の既定値に依存せず、origin/CSRFチェックを明示的に有効にして本番と同じ条件で試験する。

Git除外には環境ファイル・状態・DB・鍵・HAR・SQLダンプを含め、app/migrationsのSQLと設定例はGit管理する。Gitleaks等によるファイル/履歴スキャンはignoreテストとは別に実施し、機密値を出力せず、検出したサンプル値と実際の漏えいを区別する。

## Drizzle / D1

`drizzle-schema.test.ts` は全テーブルのDrizzle定義とmigration適用後の列・型・null制約・主キー・外部キーを照合する。`d1-atomic.test.ts` は実際のD1 batch rollback、同時加減算・完了、部分更新、締めを検証する。ApplicationのRepository portへDrizzle型を漏らさない。

`summary.test.ts` は複数家事・日付・週・チームを混在させ、ホーム/月次集計の完了が混ざらないこと、完了者がNULLでも完了状態を保持すること、月またぎ週を終了月へ表示することを実D1で確認する。不正な集計DTOは共通clientのテストで拒否を確認し、画面側の空一覧への変換で隠さない。

## 日本時間と端末タイムゾーン

業務日付はJST、保存する時刻はUTCのISO 8601文字列、対象日・対象月は日付文字列として扱う。ブラウザーやコンテナの既定timezoneに依存させない。日付のみの計算にはUTCフィールドを用い、現在時刻を日付に変換するときはAsia/Tokyoを明示する。

`tests/e2e/application.spec.ts` はUTC・Los Angeles・Aucklandのブラウザーで、UTCと日本で日付・月が異なる時刻のヘッダー・集計月・カレンダーの今日とセルを確認する。日付utilityと招待期限のテストは `TZ=UTC` / `TZ=America/Los_Angeles` / `TZ=Pacific/Auckland` を付けたVitestでも実行できる。これはテスト時の環境変更で、配備にTZ環境変数を要求するものではない。

`user-schema.test.ts` は0001→0002→0003→0004でrevision列/テーブルを撤去し、0005でToDoへ移行し、業務データを保持すること、認証日時・nullable期限・Push配信日時のISO変換とミリ秒精度を検証する。セッション期限での絞り込み、期限切れOAuth stateの削除、rate limitの加算・429・期間経過後の解除も実Better Auth/D1で確認する。`push.test.ts` はISO形式のlease比較・再取得・成功後再送抑止を検証する。

## ToDo移行とカテゴリー

カテゴリーの横スワイプはUIで左右の切り替え、保存順（未分類を含む）、空カテゴリー、先頭/末尾、タップ併用、追加フォームへの選択反映を確認する。ジェスチャー単体では短い移動・縦/斜め移動・縦から横への方向変更・中断・複数指・マウス選択・操作部品からの開始を除外することを検証する。E2Eでは独立したユーザーと実タッチ入力を使い、ホーム・ToDoの1件/0件で表示内容の下の余白を開始点にして切り替えられることを確認する。ToDoページは追加ボタンの上まで広がる余白を使い、elementFromPointで開始点が操作領域に含まれることも確認する。スクロール可能なホームの余白では縦スクロールを維持することを確認する。モバイルE2Eでは両画面の切り替え、タブ列の横スクロール、選択タブの可視性、並べ替えの維持も確認する。iPhone実機Safariの検証とは扱わない。

`tests/server/todos.test.ts`は旧買い物テーブルからのデータ保持・テーブル数不変・既存項目の未分類と空のカテゴリー一覧、カテゴリー管理での登録・0件保持・削除時の未分類化、完了時の物理削除、チーム分離、並行登録、失敗時のbatch rollback、入力制限を実D1で検証する。ToDo画面テストでは登録済みカテゴリーの選択、候補がない場合の未分類、候補の初回取得待ち・失敗からの再試行、追加/編集の入力中にカテゴリーが削除された際の未分類化と他の入力保持、同名再登録時のフィルター解除維持、編集でのカテゴリー解除、絞り込み、カテゴリーの追加・削除と保存失敗時の入力保持を確認する。E2Eでは「その他」からカテゴリー管理への遷移、ToDoへ戻った際の反映、ホームとToDo両画面での絞り込み・非表示項目の位置を保つ並べ替え、スマートフォンでのフィルター横スクロールとページ全体に横はみ出しがないことを確認する。

カテゴリー順序は`todo-category-order.test.ts`で0005→0006のデータ保持、未分類の先頭/途中/末尾、追加・削除後の相対順序、SQL内の所属検査、チーム分離、並行追加・削除、古い集合の拒否、nullちょうど1件と重複禁止を実D1/契約で検証する。UIでは保存中の操作抑止・保存失敗後の復元/再取得・入力保持、タブ/選択欄の保存順序を確認する。E2Eではマウス、モバイルの長押しタッチ、キーボードでの並べ替えと、リロード後の管理画面/ホーム/ToDo/選択欄への反映を検証する。タッチ検証はChromiumの端末エミュレーションでありiPhone実機Safariではない。

固定ID化は、別チーム/削除済みIDのToDo保存拒否（既存行・並び順を変更しない）、カテゴリー削除とToDo保存の競合、同名再作成での自動再紐付け禁止をDBで確認する。名前変更APIで更新した後もID・ToDo参照・順序が保持され、古いID配列による並べ替えが現在の名前を維持することをDBで確認する。同名への変更拒否、削除済み/別チームIDの拒否、所属失効、並行追加・削除・並べ替え・同名への更新競合、入力制限も検証する。UIでは編集モーダルの初期値、保存中の操作抑止、失敗時の入力保持、閉じて別カテゴリーを開いた際の初期化、選択とフィルターのID維持を確認する。E2Eでは名前変更後に再読込し、ホーム/ToDoに新しい名前が反映されて既存ToDoを絞り込めることを確認する。

`todo-category-conversion.test.ts` は手動変換のdry-run、未分類位置の保持、名前・メモ・日時・ToDo参照の保持、変換前後の再実行、0005での実行、不整合拒否、D1 batch rollback、0007適用後の列・外部キーを使い捨てD1で確認する。実本番DBへの手動変換はCIやPR作成時には実行しない。
