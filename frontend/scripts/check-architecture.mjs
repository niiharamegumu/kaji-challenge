import { readFileSync, readdirSync, statSync } from "node:fs";
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

function isComponent(path) {
  return /\/(components|routes)\//.test(rel(path)) && path.endsWith(".tsx");
}

function violationsFor(path, imports) {
  const file = rel(path);
  const violations = [];
  const sourceFeature = feature(path);
  const inShared = file.startsWith("src/shared/");

  for (const item of imports) {
    const resolved = resolveImport(path, item.value);
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
    if (
      isComponent(path) &&
      !item.typeOnly &&
      resolved.includes("src/lib/api/generated/client")
    ) {
      violations.push(`${file} imports ${item.value}`);
    }
  }
  return violations;
}

const baseline = new Set(
  readFileSync(join(root, "architecture-baseline.txt"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#")),
);

const violations = [];
for (const path of walk(join(root, "src"))) {
  if (rel(path).startsWith("src/lib/api/generated/")) {
    continue;
  }
  violations.push(
    ...violationsFor(path, extractImports(readFileSync(path, "utf8"))),
  );
}

const current = new Set(violations);
const newViolations = [...current].filter((item) => !baseline.has(item)).sort();
const staleBaseline = [...baseline].filter((item) => !current.has(item)).sort();

if (newViolations.length > 0 || staleBaseline.length > 0) {
  if (newViolations.length > 0) {
    console.error("Feature boundary violations:");
    for (const item of newViolations) {
      console.error(`  ${item}`);
    }
  }
  if (staleBaseline.length > 0) {
    console.error("Stale frontend architecture baseline entries:");
    for (const item of staleBaseline) {
      console.error(`  ${item}`);
    }
  }
  process.exit(1);
}

console.log(
  `Frontend architecture boundary check passed (${current.size} baseline exceptions).`,
);
