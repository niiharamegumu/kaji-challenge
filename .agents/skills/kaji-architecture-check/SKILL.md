---
name: kaji-architecture-check
description: KajiChalle の backend/frontend 構造、package 境界、import、shared code 配置、feature public API を変更または architecture violation を確認するときに使う。
---

# Kaji Architecture Check

`docs/architecture.md` を source of truth とします。

1. `AGENTS.md` と `docs/architecture.md` を読む。
2. 変更対象を分類する。
   - backend domain/application/adapter/transport/persistence/external
   - frontend app/features/shared/lib/api
   - generated OpenAPI/sqlc boundary
3. backend 変更では以下を守る。
   - domain は project package import を持たない。
   - application は Gin、OpenAPI generated types、sqlc、transport、middleware、adapter implementation に依存しない。
   - sqlc は persistence 内に閉じる。
   - OpenAPI generated types は transport boundary に閉じる。
4. frontend 変更では以下を守る。
   - 他 feature の internals を import しない。
   - feature 間の参照は `src/features/<feature>/index.ts` の public API 経由にする。
   - cross-feature UI は `shared/components` に置く。
   - cross-feature query/state helper は `shared/query` または `shared/state` に置く。
   - generated API client types を components/routes に value import しない。
5. 構造変更や import 境界変更では `make architecture-check` を実行する。
6. 例外が必要に見える場合は、baseline exception を追加せず、いったん止めて tradeoff を報告する。
