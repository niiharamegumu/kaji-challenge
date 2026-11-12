import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertSupportedNodeVersion, minimumNodeVersion } from "./runtime-security-policy.mjs";

for (const version of ["24.22.3", "24.22.4", "24.23.0"]) {
  test(`accepts supported patched Node.js ${version}`, () => {
    assert.doesNotThrow(() => assertSupportedNodeVersion(version));
  });
}

for (const version of [
  "24.22.1",
  "24.22.2",
  "24.21.99",
  "22.23.5",
  "26.13.1",
  "24.22.3-rc.1",
  "24.22",
  "invalid",
]) {
  test(`rejects unpatched or unsupported Node.js ${version}`, () => {
    assert.throws(() => assertSupportedNodeVersion(version), /November 2026 security fixes/);
  });
}

test("keeps the runtime requirement aligned with package.json engines", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.engines.node, `>=${minimumNodeVersion} <25`);
});
