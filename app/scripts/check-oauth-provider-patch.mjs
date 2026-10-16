// Updating the provider requires reviewing the verified revocation hook before deployment.
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { findPackageJSON } from "node:module";
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

// Agents now declares the patched MCP versions itself. Verify the peer packages
// resolved from both consumers rather than retaining the old override exception.
const appManifestUrl = new URL("package.json", root);
async function resolvedPackage(name, parent) {
  const path = findPackageJSON(name, parent);
  assert(path, `Install ${name}`);
  const metadata = JSON.parse(await readFile(path, "utf8"));
  assert.equal(metadata.name, name);
  return { path, metadata };
}

const reviewedAgentsVersion = "0.28.1";
assert.equal(
  manifest.dependencies.agents,
  reviewedAgentsVersion,
  "Review the documented MCP dependency compatibility before changing Agents",
);
const agents = await resolvedPackage("agents", appManifestUrl);
assert.equal(agents.metadata.version, reviewedAgentsVersion, "Install the reviewed Agents version");
for (const name of [
  "@modelcontextprotocol/client",
  "@modelcontextprotocol/server",
  "@modelcontextprotocol/sdk",
]) {
  const expectedVersion = agents.metadata.peerDependencies?.[name];
  assert.match(expectedVersion, /^\d+\.\d+\.\d+$/, `Review the ${name} peer version policy`);
  for (const parent of [appManifestUrl, agents.path]) {
    const resolved = await resolvedPackage(name, parent);
    assert.equal(
      resolved.metadata.version,
      expectedVersion,
      `Install ${name} at the version required by Agents ${reviewedAgentsVersion}`,
    );
  }
  assert.equal(manifest.overrides?.[name], undefined, `Use the official Agents peer for ${name}`);
}
assert.equal(
  manifest.dependencies["@modelcontextprotocol/server"],
  agents.metadata.peerDependencies["@modelcontextprotocol/server"],
  "Declare the MCP server version required by Agents",
);
assert.equal(
  manifest.overrides?.["@modelcontextprotocol/core"],
  undefined,
  "Let the MCP packages resolve their own compatible core",
);
console.info(
  `OAuth provider ${reviewedVersion}: reviewed patch and MCP dependency versions verified.`,
);
