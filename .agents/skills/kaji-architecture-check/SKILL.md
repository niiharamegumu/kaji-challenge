---
name: kaji-architecture-check
description: KajiChalleのTypeScript server・React featuresの配置やimport境界を変更・検証するときに使う。
---

# Kaji Architecture Check

`docs/architecture.md` を source of truth とします。

1. `AGENTS.md` と `docs/architecture.md` を読む。
2. 変更対象を分類する。
   - app/src/server の transport/application/domain/infrastructure
   - app/src の app/features/shared/lib/api/contracts
3. 現用serverはApplication/DomainからReact・Start・Better Auth・Drizzle・pgをimportしない。transportで依存を組み立て、infrastructureがportを実装する。DB clientをリクエスト間で共有しない。

4. frontend 変更では以下を守る。
   - 他 feature の internals を import しない。
   - feature 間の参照は `src/features/<feature>/index.ts` の public API 経由にする。
   - cross-feature UI は `shared/components` に置く。
   - cross-feature query/state helper は `shared/query` または `shared/state` に置く。
   - components/routesからserver実装を直接importせずfeature adapterを使う。
5. 構造変更や import 境界変更では `make architecture-check` を実行する。
6. 例外が必要に見える場合は、baseline exception を追加せず、いったん止めて tradeoff を報告する。
