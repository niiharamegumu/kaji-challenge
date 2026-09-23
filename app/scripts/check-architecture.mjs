import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (["node_modules", "dist", "coverage", ".vite"].includes(name)) {
        continue;
      }
      entries.push(...walk(path));
      continue;
    }
    if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      entries.push(path);
    }
  }
  return entries;
}

function rel(path) {
  return relative(root, path).split(sep).join("/");
}

function extractImports(content) {
  const imports = [];
  for (const match of content.matchAll(
    /^\s*import\s+(type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["'];?/gm,
  )) {
    imports.push({ value: match[2], typeOnly: Boolean(match[1]) });
  }
  for (const match of content.matchAll(/^\s*import\s*["']([^"']+)["'];?/gm)) {
    imports.push({ value: match[1], typeOnly: false });
  }
  for (const match of content.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g))
    imports.push({ value: match[1], typeOnly: false });
  return imports;
}

function resolveImport(fromPath, specifier) {
  if (!specifier.startsWith(".")) {
    return specifier;
  }
  const fromDir = rel(join(fromPath, ".."));
  const parts = [];
  for (const part of `${fromDir}/${specifier}`.split("/")) {
    if (part === "." || part === "") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function feature(path) {
  const parts = rel(path).split("/");
  if (parts[0] !== "src" || parts[1] !== "features") {
    return "";
  }
  return parts[2] ?? "";
}

function violationsFor(path, imports) {
  const file = rel(path);
  const violations = [];
  const sourceFeature = feature(path);
  const inShared = file.startsWith("src/shared/");

  for (const item of imports) {
    const resolved = resolveImport(path, item.value);
    const inCore = /^src\/server\/(application|domain)\//.test(file);
    if (
      inCore &&
      (/^(react|@tanstack|drizzle-orm|better-auth|cloudflare:)/.test(resolved) ||
        /^src\/server\/(infrastructure|transport)\//.test(resolved) ||
        /^src\/(features|app|lib)\//.test(resolved))
    )
      violations.push(`${file} imports forbidden server dependency ${item.value}`);
    if (
      !file.startsWith("src/server/") &&
      resolved.startsWith("src/server/") &&
      !item.typeOnly &&
      !(file === "src/contracts/operations.ts" && resolved === "src/server/domain/dates") &&
      file !== "src/server-entry.ts" &&
      !(
        file === "src/lib/api/serverClient.ts" &&
        resolved === "src/server/transport/operations.functions"
      )
    )
      violations.push(`${file} imports server implementation ${item.value}`);
    if (inShared && resolved.startsWith("src/features/")) {
      violations.push(`${file} imports ${item.value}`);
    }
    if (sourceFeature !== "" && resolved.startsWith("src/features/")) {
      const parts = resolved.split("/");
      const targetFeature = parts[2] ?? "";
      const targetLayer = parts[3] ?? "";
      if (
        targetFeature !== "" &&
        targetFeature !== sourceFeature &&
        ["components", "hooks", "state", "lib"].includes(targetLayer)
      ) {
        violations.push(`${file} imports ${item.value}`);
      }
    }
  }
  return violations;
}

const violations = [];
for (const path of walk(join(root, "src"))) {
  violations.push(...violationsFor(path, extractImports(readFileSync(path, "utf8"))));
}
if (violations.length) {
  console.error("Application dependency boundary violations:");
  for (const violation of new Set(violations)) console.error(`  ${violation}`);
  process.exit(1);
}
console.log("Application architecture boundary check passed.");
