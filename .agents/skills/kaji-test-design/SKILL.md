---
name: kaji-test-design
description: KajiChalle のテスト設計、追加、レビュー、修正で使う。Go backend tests、Vitest frontend tests、integration DB tests、API contract coverage、検証コマンド選択を扱う。
---

# Kaji Test Design

`docs/testing.md` を source of truth とします。

1. テスト対象の挙動を分類する。
   - domain rule
   - usecase orchestration
   - persistence/DB behavior
   - transport/API boundary
   - frontend API adapter/hook
   - frontend route/component user flow
2. 挙動を観測できる最小の層にテストを置く。
3. validation、状態遷移、日付境界、error matrix は table-driven tests を優先する。
4. regression では、修正前または修正と同時に bug を証明する failing scenario を書く。
5. backend DB tests では既存の `TEST_DATABASE_URL` isolation approach を使う。
6. frontend tests では Testing Library を通して visible behavior と user interaction を検証する。
7. auth、team scoping、stale ETag、invalid input、date boundary など重要な negative path を対象に含める。
8. 検証コマンドを選ぶ。
   - `make test-backend`
   - `make test-frontend`
   - `make architecture-check`
   - cross-stack または high-risk changes では `make check`
9. 最終報告では、意図的に追加しなかったテストと理由を明記する。
