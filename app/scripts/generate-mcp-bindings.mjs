// Keep Wrangler's Worker-specific namespaces local to this generated module.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const appDirectory = fileURLToPath(new URL("../", import.meta.url));
const temporaryName = `.mcp-bindings-${randomUUID()}.d.ts`;
const temporaryPath = new URL(`../${temporaryName}`, import.meta.url);
const outputPath = new URL("../mcp-worker-configuration.d.ts", import.meta.url);
try {
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
      "types",
      temporaryName,
      "--config",
      "wrangler.mcp.jsonc",
      "--config",
      "wrangler.jsonc",
      "--env-interface",
      "McpEnv",
      "--include-runtime",
      "false",
    ],
    {
      cwd: appDirectory,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: "inherit",
    },
  );
  // Normalize only the generated command comment so regeneration is deterministic.
  const generated = (await readFile(temporaryPath, "utf8")).replaceAll(
    temporaryName,
    "mcp-worker-configuration.d.ts",
  );
  if (
    !/KAJI_APPLICATION:\s*Service<typeof import\(["']\.\/src\/server-entry["']\)\.McpApplication>/.test(
      generated,
    )
  ) {
    throw new Error(
      "Wrangler did not find the McpApplication named entrypoint; generate after exporting it from server-entry.ts",
    );
  }
  if (
    /\b(?:DB|OAUTH_KV|BETTER_AUTH_SECRET|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|SIGNUP_ALLOWED_EMAILS|VAPID_PRIVATE_KEY):/.test(
      generated,
    )
  ) {
    throw new Error("MCP bindings must not include application storage or secrets");
  }
  await writeFile(
    temporaryPath,
    `${generated}\n// Exporting makes Cloudflare and NodeJS namespaces module-local.\nexport type { McpEnv };\n`,
  );
  await rename(temporaryPath, outputPath);
} finally {
  await rm(temporaryPath, { force: true });
}
