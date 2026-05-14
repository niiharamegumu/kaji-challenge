---
name: kaji-api-change
description: KajiChalle の API 挙動、request/response schema、生成 client、backend transport handler、frontend API adapter を変更するときに使う。OpenAPI first と生成コード検証を徹底する。
---

# Kaji API Change

API 挙動や schema を変更するときは、この手順に従います。

1. `AGENTS.md`、`docs/architecture.md`、`docs/testing.md` を読む。
2. backend/frontend を編集する前に、public API の変更点を `api/openapi.yaml` で特定する。
3. 先に `api/openapi.yaml` を更新する。
4. 必要最小限の生成 target を実行する。
   - backend-only の generated server type 変更: `make gen-backend`
   - frontend-only の generated client 変更: `make gen-frontend`
   - cross-stack 変更: `make gen`
5. Clean Architecture 境界に従って backend transport/usecase/persistence を更新する。
6. Feature-Based Architecture 境界に従って frontend feature API adapter、hook、UI を更新する。
7. テストを追加または更新する。
   - status code、cookie/header、error mapping、response shape は backend transport tests で確認する。
   - business rule や保存挙動が変わる場合は backend usecase/persistence tests を追加する。
   - user-visible flow が変わる場合は frontend adapter/hook/component tests を追加する。
8. 対象テストで検証し、生成結果の整合性が重要な場合は `make diff-gen` を実行する。
9. 変更した API 挙動、生成ファイル、検証コマンド、残るリスクを報告する。

生成ファイルは、確認目的を除き手編集しない。
