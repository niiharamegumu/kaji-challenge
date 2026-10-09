// Updating the provider requires reviewing the verified revocation hook before deployment.
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const packageName = "@cloudflare/workers-oauth-provider";
const reviewedVersion = "1.2.3";
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const installed = JSON.parse(
  await readFile(new URL(`node_modules/${packageName}/package.json`, root), "utf8"),
);
assert.equal(
  manifest.dependencies[packageName],
  reviewedVersion,
  "Review the OAuth revocation patch before changing the provider version; see docs/mcp-oauth-provider-patch.md",
);
assert.equal(installed.name, packageName);
assert.equal(installed.version, reviewedVersion, "Install the reviewed OAuth provider version");
const patch = manifest.patchedDependencies?.[`${packageName}@${reviewedVersion}`];
assert.equal(typeof patch, "string", "The verified OAuth revocation patch must remain registered");
assert(patch.startsWith("patches/") && patch.endsWith(".patch"));
// Bun uses a literal %2F in scoped-package patch names, not a URL-encoded separator.
await access(join(fileURLToPath(root), patch));

// Agents pins these peers to older vulnerable clients. This limited exception
// must be reconsidered when Agents/server change; never override their core globally.
const reviewedMcpDependencies = [
  ["dependencies", "agents", "0.27.0"],
  ["dependencies", "@modelcontextprotocol/server", "2.0.0"],
  ["overrides", "@modelcontextprotocol/client", "2.2.0"],
  ["overrides", "@modelcontextprotocol/sdk", "1.31.0"],
];
for (const [section, name, version] of reviewedMcpDependencies) {
  assert.equal(
    manifest[section]?.[name],
    version,
    "Review the documented MCP peer exceptions before changing the dependency versions",
  );
  const resolved = JSON.parse(
    await readFile(new URL(`node_modules/${name}/package.json`, root), "utf8"),
  );
  assert.equal(resolved.version, version, `Install the reviewed ${name} version`);
}
assert.equal(
  manifest.overrides?.["@modelcontextprotocol/core"],
  undefined,
  "Keep the server and client core versions separate",
);
console.info(
  `OAuth provider ${reviewedVersion}: reviewed patch and MCP dependency versions verified.`,
);
