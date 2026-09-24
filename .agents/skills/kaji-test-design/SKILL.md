---
name: kaji-test-design
description: KajiChalle のテスト設計、追加、レビュー、修正で使う。Vitest/Testing Library、Workers、D1、Playwright、Zod契約を扱う。
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
5. backend DB tests では`tests/helpers/d1.ts` の使い捨てD1 fixture を使う。
6. frontend tests では Testing Library を通して visible behavior と user interaction を検証する。
7. auth、team scoping、stale revision、invalid input、date boundary など重要な negative path を対象に含める。
8. 検証コマンドを選ぶ。
   - UI: `make test`
   - TS server/DB: `cd app && bun run test:server --run`（fixtureがD1を自動作成・破棄。skipを成功扱いしない）
   - `make architecture-check`
   - build・型・lint・UI: `make check`
   - DB・ブラウザーを含む全体: `cd app && bun run test:local`
9. 最終報告では、意図的に追加しなかったテストと理由を明記する。
