import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

let directory: string;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "kaji-ignore-test-"));
  execFileSync("git", ["init", "-q", directory]);
  copyFileSync(new URL("../../../.gitignore", import.meta.url), join(directory, ".gitignore"));
});
afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it("excludes secrets, deployment state and database exports at every supported location", () => {
  const paths = [
    ".env",
    "app/.env.production",
    ".dev.vars",
    ".dev.vars.production",
    "app/.dev.vars.bak",
    ".alchemy/state.json",
    "app/.alchemy/state.json",
    "app/.wrangler/cache/data.sqlite",
    "credentials.json",
    "app/service-account-production.json",
    "private.key",
    "certificate.p12",
    "backup.dump",
    "app/export.sqlite",
    "app/export.sqlite-wal",
    "app/backup.sql.gz",
    "app/production-export.sql",
    "backup.sqlite3",
    "backup.sqlite3-wal",
    "auth-session.har",
    "id_rsa",
    "id_ed25519",
    "local-notes/production-audit.json",
  ];
  const ignored = execFileSync("git", ["check-ignore", "--stdin"], {
    cwd: directory,
    input: paths.join("\n") + "\n",
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  expect(ignored).toEqual(paths);
});

it("keeps configuration templates and SQL migration history reviewable", () => {
  const paths = [
    ".env.example",
    "app/.dev.vars.example",
    "app/wrangler.jsonc",
    "app/alchemy.run.ts",
    "app/migrations/0001_initial.sql",
  ];
  // --non-matching reports every path; empty pattern fields indicate no ignore rule.
  const lines = execFileSync("git", ["check-ignore", "--stdin", "--verbose", "--non-matching"], {
    cwd: directory,
    input: paths.join("\n") + "\n",
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  expect(lines).toHaveLength(paths.length);
  for (const line of lines) expect(line).toMatch(/^(?:::\t|.*:!)/);
});
