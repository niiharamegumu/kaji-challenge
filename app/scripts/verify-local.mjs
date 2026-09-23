import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const source = new URL("../", import.meta.url).pathname;
const temp = await mkdtemp(join(tmpdir(), "kaji-local-check-"));
const appDirectory = join(temp, "app");
const results = [];
// Real development credentials, databases and build outputs never enter this checkout.
const excluded = new Set([
  "node_modules",
  "dist",
  ".wrangler",
  ".alchemy",
  ".tanstack",
  ".vite",
  "test-results",
  "playwright-report",
  "coverage",
]);
const env = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "CI", "PLAYWRIGHT_BROWSERS_PATH", "SYSTEMROOT"]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
Object.assign(env, {
  PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
  KAJI_D1_TEST_PATH: join(temp, "d1"),
  ALCHEMY_HOME: join(temp, "alchemy"),
  ALCHEMY_TELEMETRY_DISABLED: "1",
  WRANGLER_LOG_PATH: join(temp, "wrangler.log"),
  WRANGLER_SEND_METRICS: "false",
});
async function run(name, command, args) {
  const start = Date.now();
  console.info(`Checking: ${name}`);
  let status = "failed";
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: appDirectory, env, stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`${name} failed (${code})`)),
      );
    });
    status = "passed";
  } finally {
    results.push({ name, status, durationMs: Date.now() - start });
  }
}
try {
  await cp(source, appDirectory, {
    recursive: true,
    filter: (path) => {
      const name = basename(path);
      return (
        !excluded.has(name) &&
        !name.startsWith(".env") &&
        !name.startsWith(".dev.vars") &&
        !name.endsWith(".tsbuildinfo")
      );
    },
  });
  await symlink(join(source, "node_modules"), join(appDirectory, "node_modules"), "dir");
  await copyFile(new URL("../../.gitignore", import.meta.url), join(temp, ".gitignore"));
  await run("Formatting", "node_modules/.bin/vp", ["fmt", "--check"]);
  // Exercise CLI-only peer dependencies without credentials or cloud mutations.
  for (const args of [["provider", "cloudflare", "bootstrap"], ["plan"], ["deploy"]]) {
    await run(`Alchemy ${args.at(-1)} CLI`, "node_modules/.bin/alchemy", [...args, "--help"]);
  }
  await writeFile(
    join(appDirectory, ".dev.vars"),
    [
      "BETTER_AUTH_SECRET=kaji-e2e-only-secret-do-not-use-in-production",
      "GOOGLE_CLIENT_ID=e2e-local-only",
      "GOOGLE_CLIENT_SECRET=e2e-local-only",
      "SIGNUP_ALLOWED_EMAILS=allowlisted@example.com",
      "VAPID_PRIVATE_KEY=unused-local-test-key",
      "",
    ].join("\n"),
  );
  for (const name of ["Initial D1 migration", "D1 migration replay"]) {
    await run(name, "node_modules/.bin/wrangler", [
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      env.KAJI_D1_TEST_PATH,
    ]);
  }
  await run("Workers build", "node_modules/.bin/vp", ["build"]);
  await run("TypeScript application", "node_modules/.bin/tsc", ["-b"]);
  await run("TypeScript infrastructure and tests", "node_modules/.bin/tsc", [
    "-p",
    "tsconfig.infra.json",
  ]);
  await run("Oxlint", "node_modules/.bin/vp", ["lint"]);
  await run("React Compiler lint", "node_modules/.bin/eslint", ["src/**/*.{ts,tsx}"]);
  await run("Application architecture", process.execPath, ["scripts/check-architecture.mjs"]);
  await run("UI tests", "node_modules/.bin/vp", ["test", "--run"]);
  await run("D1, authentication and IaC tests", "node_modules/.bin/vp", [
    "test",
    "--config",
    "vitest.server.config.ts",
    "--run",
  ]);
  await run("Browser, PWA and interaction tests", "node_modules/.bin/playwright", ["test"]);
  await run("Development startup and reload stability", "node_modules/.bin/playwright", [
    "test",
    "--config",
    "playwright.dev.config.ts",
  ]);
  console.info("Local verification passed.");
} finally {
  const output = join(source, "test-results");
  await mkdir(output, { recursive: true });
  await cp(join(appDirectory, "test-results"), output, { recursive: true }).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await writeFile(
    join(output, "local-verification.json"),
    JSON.stringify({ finishedAt: new Date().toISOString(), results }, null, 2) + "\n",
  );
  await rm(temp, { recursive: true, force: true });
}
