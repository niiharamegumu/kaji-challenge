import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  browserArguments,
  changedPaths,
  fullVerificationPlan,
  verificationPlan,
} from "./verification-plan.mjs";

const selected = (paths) => verificationPlan(paths).browserTags;
test("manual verification and unavailable diffs run every optional check", () => {
  for (const plan of [fullVerificationPlan(), verificationPlan(null)]) {
    assert.equal(plan.browserTags, null);
    assert.equal(plan.alchemy, true);
    assert.equal(plan.development, true);
    assert.deepEqual(browserArguments(plan), ["test"]);
  }
});
test("documentation and server-test-only changes retain smoke checks", () => {
  for (const paths of [
    [],
    ["README.md", "docs/testing.md"],
    ["app/tests/server/assist-ai.test.ts"],
  ]) {
    const plan = verificationPlan(paths);
    assert.deepEqual(plan.browserTags, ["@smoke"]);
    assert.equal(plan.alchemy, false);
    assert.equal(plan.development, false);
  }
});
test("assist changes include model, contract and media fixture coverage", () => {
  assert.deepEqual(
    selected([
      "app/src/features/assist/lib/capture.ts",
      "app/src/server/infrastructure/assist-ai.ts",
      "app/src/contracts/assist.ts",
      "app/tests/e2e/assist-fixture.ts",
    ]),
    ["@smoke", "@assist"],
  );
});
test("multiple feature changes select their union, without duplicate tags", () => {
  assert.deepEqual(
    selected([
      "app/src/features/todos/hooks/useTodos.ts",
      "app/src/features/summary/components/SummaryPage.tsx",
      "app/src/features/todos/components/TodoPage.tsx",
      "docs/architecture.md",
    ]),
    ["@smoke", "@summary", "@todos"],
  );
  assert.deepEqual(selected(["app/src/features/reminders/components/ReminderCalendarPage.tsx"]), [
    "@smoke",
    "@calendar",
  ]);
});
for (const path of [
  "app/src/features/auth/components/LoginPage.tsx",
  "app/src/features/shell/components/FloatingNav.tsx",
  "app/src/shared/query/todoQueries.ts",
  "app/src/server/infrastructure/auth.ts",
  "app/src/contracts/operations.ts",
  "app/migrations/0011_example.sql",
  "app/tests/helpers/d1.ts",
  "app/tests/e2e/application.spec.ts",
])
  test(`shared or security-sensitive change runs all browsers: ${path}`, () => {
    const plan = verificationPlan([path]);
    assert.equal(plan.browserTags, null);
    assert.equal(plan.alchemy, false);
    assert.equal(plan.development, false);
  });
for (const path of [
  "app/package.json",
  "app/bun.lock",
  "mise.toml",
  "app/vite.config.ts",
  "app/alchemy.run.ts",
  "app/infra/config.ts",
  ".github/workflows/ci.yml",
  "app/scripts/verify-local.mjs",
])
  test(`runtime or verification configuration enables all checks: ${path}`, () => {
    const plan = verificationPlan([path]);
    assert.equal(plan.browserTags, null);
    assert.equal(plan.alchemy, true);
    assert.equal(plan.development, true);
  });
test("development tests enable dev startup without requiring Alchemy", () => {
  const plan = verificationPlan(["app/tests/dev/startup.spec.ts"]);
  assert.deepEqual(plan.browserTags, ["@smoke"]);
  assert.equal(plan.alchemy, false);
  assert.equal(plan.development, true);
});
test("unrecognized paths and new features fail closed to full verification", () => {
  for (const paths of [
    ["app/src/features/new-feature/index.ts"],
    ["new-config.json"],
    ["../README.md"],
    [""],
  ]) {
    const plan = verificationPlan(paths);
    assert.equal(plan.browserTags, null);
    assert.equal(plan.alchemy, true);
    assert.equal(plan.development, true);
  }
});
test("a deleted shared file still widens coverage when moved into a feature", () => {
  assert.equal(
    selected(["app/src/shared/example.ts", "app/src/features/assist/lib/example.ts"]),
    null,
  );
});
test("invalid or missing base commits cannot produce an empty successful diff", () => {
  assert.equal(changedPaths(undefined, process.cwd()), null);
  assert.equal(changedPaths("main; touch /tmp/unsafe", process.cwd()), null);
  const cwd = mkdtempSync(join(tmpdir(), "kaji-diff-missing-"));
  try {
    assert.equal(changedPaths("0".repeat(40), cwd), null);
  } finally {
    rmSync(cwd, { recursive: true });
  }
});
test("browser grep matches complete tags and retains smoke across both projects", () => {
  const args = browserArguments(verificationPlan(["app/src/features/assist/index.ts"]));
  assert.deepEqual(args.slice(0, 2), ["test", "--grep"]);
  const pattern = new RegExp(args[2]);
  assert.equal(pattern.test("desktop startup @smoke @auth"), true);
  assert.equal(pattern.test("mobile assist @assist"), true);
  assert.equal(pattern.test("other @assistant"), false);
  assert.equal(pattern.test("calendar @calendar"), false);
});
