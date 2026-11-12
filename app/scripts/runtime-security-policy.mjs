import assert from "node:assert/strict";

// https://nodejs.org/en/blog/vulnerability/november-2026-security-releases
// Keep the supported major aligned with package.json engines.node.
export const minimumNodeVersion = "24.22.3";

export function assertSupportedNodeVersion(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const [major, minor, patch] = parts ? parts.slice(1).map(Number) : [];
  const [requiredMajor, requiredMinor, requiredPatch] = minimumNodeVersion.split(".").map(Number);
  assert(
    major === requiredMajor &&
      (minor > requiredMinor || (minor === requiredMinor && patch >= requiredPatch)),
    `Node.js ${version}: Node.js >=${minimumNodeVersion} <25 is required for the November 2026 security fixes. Run mise install and use mise exec --.`,
  );
}
