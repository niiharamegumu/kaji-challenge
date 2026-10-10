# OAuth providerの失効patch

## 目的と境界

`@cloudflare/workers-oauth-provider@1.2.3` の標準RFC 7009 endpointは、client認証とtokenの真正性・所有者を確認してKVを削除する。未修正の公開APIには、この検証後・KV削除前にアプリのD1失効を確定するhookがない。KVだけの削除では、伝播の遅延や並行refreshで残ったtokenを業務処理が受け付ける可能性がある。

Bunの `patchedDependencies` に登録するpatchは、検証済みの失効要求をアプリへ通知するcallbackだけを追加する。Kaji側でopaque tokenを分解したり、KVの非公開キー形式や秘密部分の検証を複製したりしない。元のSDKのclient認証、token照合、所有者確認、無効tokenへの200応答を維持する。

callbackは検証済みuserId・clientId・grantId・token種別を受け、`D1McpRepository` が3つのIDに一致する連携行を失効させる。D1更新をawaitしてからSDKがKV削除へ進む。access token・refresh tokenのどちらの失効要求でも、Kajiでは対応する連携全体を停止する。再利用には本人の再同意が必要となる。SDKの管理API `revokeGrant()` はこのHTTP callbackを通らないため、アプリの管理画面は従来どおりD1先行で解除する。

## 失敗・並行処理

- client認証失敗、別clientのtoken、不正な秘密部分ではcallbackを呼ばず、D1を変更しない。
- D1更新失敗や連携の照合失敗は503とし、成功した失効として200を返さない。クライアントは再試行できる。
- D1更新が確定した後にKV削除が失敗しても、D1の失効は取り消さない。tokenの検証・Application認可・ToDo更新SQLが拒否を維持する。
- 並行refreshが失効前の状態を読み、失効後にKVへ新tokenを保存する場合でも、D1の連携は復活しない。そのtokenによる業務アクセスと次のrefreshは拒否する。
- 失効より先に確定した業務更新は取り消さず、既に送信した応答も回収しない。保証する境界はD1失効の確定後の認可・SQL実行である。

KVの全世界同時削除や、進行中のtoken発行の強制中断を保証するpatchではない。providerに残ったKVレコードの清掃と、業務アクセスを拒否するD1状態を区別する。

## 保守範囲

正本は `app/patches/` 内のpatch、`app/package.json` の固定versionと `patchedDependencies`、`app/bun.lock`。インストール済み `node_modules` だけを編集して運用しない。npm配布物のruntime JavaScriptと公開型定義への差分を管理し、SDK全体をアプリへコピーしない。

`app/scripts/check-oauth-provider-patch.mjs` は、review済みversion、依存宣言、installed version、patch登録の一致を検査する。`build` と `test:local` から実行するため、上流versionを更新してpatchの再確認を省略するとCI/CDが失敗する。この検査は挙動の証明ではなく、意図しない更新・登録削除を止める確認である。

CI/CDの `bun install --frozen-lockfile` でlockとpatchを再現し、型検査と実providerの回帰テストでcallbackの実行位置・失敗処理を検証する。patch適用エラーや失効テスト失敗を無視して配備しない。

上流更新時は次の手順を取る。

1. 新版の失効処理と公開APIを読み、client認証・秘密部分の検証・所有者検査後、KV削除前にawaitされる公式hookがあるか確認する。
2. 公式hookが要件を満たせばアプリを公式APIへ移しpatchを撤去する。存在しない場合は新版へ最小差分を作り直す。旧patchの機械的な成功だけを採用理由にしない。
3. version、patch登録、lock、確認スクリプトのreview済みversionと本書を同じ変更で更新する。
4. クリーンな依存インストール、型検査、失効の回帰テスト、`test:local` を実行する。無効token・別client、D1障害、KV障害、並行refreshのケースを残す。

patchは上流への採用や互換性を保証するものではない。上流更新時の再reviewはこのリポジトリで引き受ける。

## Refresh tokenの既知の制約

provider 1.2.3はcurrentとpreviousのrefresh tokenを受け付ける。previousには時間制限がなく、後継tokenが初めて使われるまで繰り返し利用できる。さらに古いtokenを`invalid_grant`で拒否しても、現行refresh tokenやgrant全体は失効しない。これは[providerの公開仕様](https://github.com/cloudflare/workers-oauth-provider/blob/v1.2.3/docs/authorization-server.md#pkce-and-token-lifecycle)の挙動であり、[RFC 9700 §4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2)がpublic client向けrotationで示す厳密な旧token無効化・replay検出時の現行token失効を保証するものではない。

`mcp-oauth.test.ts` の2つのcharacterization testは、旧設定のSDKで作った合成tokenを直接SDKで更新し、この制約を再現する。現在のKajiがrefreshを受け付ける試験ではない。テスト成功を完全なreplay耐性と解釈しない。既存のD1先行失効patchはRFC 7009の明示解除に対応するもので、このrefresh動作を変更しない。厳格化には公式対応版・公式hookまたは方式の選定が必要であり、追加patchやtokenの独自解析で暗黙に補わない。

2026-10-09確認時点で上流の[Issue #43](https://github.com/cloudflare/workers-oauth-provider/issues/43)は未解決。maintainerは2026-02-23に、public clientのstrict rotationをbreaking changeとして将来majorで扱うため[PR #149](https://github.com/cloudflare/workers-oauth-provider/pull/149)を閉じたと説明している。[KV競合のIssue #214](https://github.com/cloudflare/workers-oauth-provider/issues/214)も未解決である。直列化だけではprevious tokenを受理する意味論は変わらず、`tokenExchangeCallback`はmismatch拒否より後なのでその拒否を検知できない。`onError`の未検証IDからgrantを失効すると第三者による強制解除を招くため、このcallbackを失効経路として使わない。

Kajiの新規同意は最大7日・自動更新なしとする。標準設定の `accessTokenTTL: 604800` / `refreshTokenTTL: 0` を使い、callbackがD1残期限でTTLを制限し、旧refreshの交換も拒否する。新しい独自patch、ASの置換、独自token解析は追加しない。SDK 1.2.3のmetadataは設定0でも `grant_types_supported` に `refresh_token` を含むが、Kajiでの実際の交換は拒否される。metadataを書き換える追加patchは行わない。

旧15分tokenの保存済み期限を変更せず、旧refresh・旧未交換コードには新しい期間を与えない。旧画面の同意claimはpolicyを含むhash namespaceと一致しないため、開き直して再同意する必要がある。新規propsにも同じpolicyを暗号化保存し、コード交換時に照合する。既存接続を7日にするには連携先から再接続・再同意する。古いD1許可記録が30日残っていても、それをtokenが使える期間として表示しない。

Bearer tokenが漏えいすると、解除・所属喪失・期限切れまで最大7日間使われるリスクがある。この期間はユーザー了承済みの方針であり、refresh rotationの代用となる安全性を主張しない。解除・現在所属・scope・audience・実token期限・D1期限を引き続き毎回確認する。SDKの相対TTLと発行処理の遅延に対しては、RSへ渡すexpiryもD1期限で制限し、D1期限後の業務アクセスを拒否する。実ChatGPTが7日間tokenを保持・再使用するか、KVの多拠点競合はローカル試験では証明できない。

MCP [2026-07-28 Refresh Tokens](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#refresh-tokens)はrefresh対応ASのmetadataで`offline_access`を広告し、clientが要求へ追加できるとする一方、RSのPRM・401 challengeには含めないことを推奨する。Kajiはrefreshを無効化したため、新規AS広告からも除外する。要求外scopeや必須scopeへ追加せず、新規同意は読み取り・書き込みの範囲だけを縮小可能とする。

## 関連するMCP SDKの限定peer例外

Agents 0.27.0の安定版はclient 2.0.0・sdk 1.30.0・server 2.0.0を完全固定のpeerとして宣言している。一方、[GHSA-6qxp-vccf-f47h](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h) の修正下限はclient 2.2.0・sdk 1.31.0である。

このリポジトリではclient 2.2.0・sdk 1.31.0の2件だけを `overrides` に固定し、Agents 0.27.0とserver 2.0.0を維持する。これは上流peer指定に対する明示的な互換例外であり、公式の対応保証ではない。使っている `agents/mcp/server` のruntime importはMCP serverとNodeのasync_hooksで、client側OAuth機能は使用しない。公式advisoryもMCP serverを対象外と説明しているが、未使用依存を監査から除外せず修正版をインストールする。

server側core 2.0.0とclient側core 2.2.0は、それぞれの要求に従って共存させる。core全体をoverrideしてserverの依存まで変更しない。公開配布物のexports・参照型の確認に加え、クリーンインストール、監査、型・build、実Workers回帰、一括検証の成功を採用条件とする。

Agentsの更新時は公式peer範囲を再確認し、修正版を正式に許容する版になったらこの2件のoverrideと確認スクリプトの対応する固定条件を同時に撤去する。client側機能を新たに使用する変更では、そのOAuth経路を別途検証する。providerの失効patchとは独立した保守項目として扱う。

## 検証

- `mcp-connections.test.ts`: 実D1のID照合、期限切れ/既失効の冪等処理、無関係行の保持。
- `mcp-oauth.test.ts`: 実providerとD1/KVのRFC 7009要求、client認証・token照合、D1先行失効、障害時の応答。
- `mcp-workers.test.ts`: 実workerdの2WorkerとService Bindingで、7日以内の発行・refresh非発行、失効後のlist/add/complete・旧refresh拒否、KV削除失敗を確認する。切替前から進行中の旧発行は、隔離したSDKのKV保存を待機させて再現し、現在のWorkerが業務を拒否することを確認する。

障害注入と並行処理の待ち合わせはローカルテストfixtureだけに置く。本番Workerへ検証用HTTP入口、失敗フラグ、秘密情報を追加しない。実CloudflareのKV伝播時間やGoogle/ChatGPTのOAuth接続をローカル試験の実績として扱わない。

公式根拠: [provider v1.2.3](https://github.com/cloudflare/workers-oauth-provider/tree/v1.2.3)、[RFC 7009 §2.1–2.2](https://www.rfc-editor.org/rfc/rfc7009#section-2.1)、[KVの整合性](https://developers.cloudflare.com/kv/concepts/how-kv-works/#consistency)、[Bun patch](https://bun.sh/docs/pm/cli/patch)。
