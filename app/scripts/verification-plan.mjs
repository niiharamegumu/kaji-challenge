import { execFileSync } from "node:child_process";

const features = new Set([
  "assist",
  "home",
  "penalties",
  "reminders",
  "settings",
  "summary",
  "tasks",
  "todos",
]);
const assistFiles = new Set([
  "app/src/contracts/assist.ts",
  "app/src/server/application/assist-operations.ts",
  "app/src/server/application/assist-ports.ts",
  "app/src/server/infrastructure/assist-ai.ts",
  "app/src/server/infrastructure/assist-budget.ts",
  "app/src/server/transport/assist.server.ts",
  "app/src/server/transport/assist-audio.ts",
  "app/tests/e2e/assist-fixture.ts",
]);
const toolingFiles = new Set([
  "Makefile",
  "mise.toml",
  "compose.yml",
  "compose.yaml",
  "docker-compose.yml",
  "docker-compose.yaml",
  "app/package.json",
  "app/bun.lock",
  "app/alchemy.run.ts",
  "app/vite.config.ts",
  "app/vitest.config.ts",
  "app/vitest.server.config.ts",
  "app/playwright.config.ts",
  "app/playwright.dev.config.ts",
  "app/wrangler.jsonc",
  "app/wrangler.mcp.jsonc",
  "app/Dockerfile.dev",
]);

export function fullVerificationPlan(reason = "Full local or manual verification") {
  return { browserTags: null, alchemy: true, development: true, reason };
}

/** Unknown paths widen coverage. Only explicitly recognized features may narrow it. */
export function verificationPlan(paths) {
  if (!Array.isArray(paths)) return fullVerificationPlan("PR diff unavailable; running all checks");
  const tags = new Set();
  let allBrowsers = false;
  let alchemy = false;
  let development = false;
  for (const path of paths) {
    if (typeof path !== "string" || !path) return fullVerificationPlan("Invalid changed path");
    if (
      toolingFiles.has(path) ||
      path.startsWith(".github/workflows/") ||
      path.startsWith("app/scripts/") ||
      path.startsWith("app/infra/")
    ) {
      allBrowsers = true;
      alchemy = true;
      development = true;
      continue;
    }
    if (path.startsWith("docs/") || (!path.includes("/") && path.endsWith(".md"))) continue;
    // All server tests always run, even when the browser selection is narrow.
    if (path.startsWith("app/tests/server/")) continue;
    if (path.startsWith("app/tests/dev/")) {
      development = true;
      continue;
    }
    if (assistFiles.has(path)) {
      tags.add("@assist");
      continue;
    }
    const feature = /^app\/src\/features\/([^/]+)\//.exec(path)?.[1];
    if (features.has(feature)) {
      tags.add(feature === "reminders" ? "@calendar" : `@${feature}`);
      continue;
    }
    if (
      // New, unclassified features must not silently fall into a narrow selection.
      feature &&
      feature !== "auth" &&
      feature !== "shell"
    )
      return fullVerificationPlan(`Unclassified feature: ${feature}`);
    if (
      path.startsWith("app/src/") ||
      path.startsWith("app/public/") ||
      path.startsWith("app/migrations/") ||
      path.startsWith("app/tests/e2e/") ||
      path.startsWith("app/tests/helpers/")
    ) {
      allBrowsers = true;
      continue;
    }
    return fullVerificationPlan(`Unclassified path: ${path}`);
  }
  return {
    browserTags: allBrowsers ? null : ["@smoke", ...Array.from(tags).sort()],
    alchemy,
    development,
    reason: allBrowsers
      ? "Shared code, configuration or browser tests changed"
      : "Smoke plus changed features",
  };
}

/** Include both names of renames so moving shared code cannot narrow coverage. */
export function changedPaths(baseSha, cwd) {
  if (!/^[a-f\d]{40}$/i.test(baseSha ?? "")) return null;
  try {
    return execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", "-z", `${baseSha}...HEAD`, "--"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    )
      .split("\0")
      .filter(Boolean);
  } catch {
    return null;
  }
}

export function browserArguments(plan) {
  if (plan.browserTags === null) return ["test"];
  // Tags are generated from the fixed allowlist above, never from shell expressions.
  const tags = plan.browserTags.map((tag) => tag.slice(1)).join("|");
  return ["test", "--grep", `@(?:${tags})(?:\\s|$)`];
}
