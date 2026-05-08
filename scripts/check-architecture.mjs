import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const sourceExtensions = new Set([".go", ".ts", ".tsx"]);
const generatedPathParts = [
  ["backend", "internal", "db", "sqlc"],
  ["backend", "internal", "openapi", "generated"],
  ["frontend", "src", "lib", "api", "generated"],
];

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if ([".git", "node_modules", "dist", "coverage", ".vite"].includes(name)) {
        continue;
      }
      entries.push(...walk(path));
      continue;
    }
    const ext = path.slice(path.lastIndexOf("."));
    if (sourceExtensions.has(ext)) {
      entries.push(path);
    }
  }
  return entries;
}

function rel(path) {
  return relative(root, path).split(sep).join("/");
}

function isGenerated(path) {
  const normalized = rel(path);
  return generatedPathParts.some((parts) => normalized.includes(parts.join("/")));
}

function extractImports(path, content) {
  if (path.endsWith(".go")) {
    const imports = [];
    for (const match of content.matchAll(/^\s*(?:[\w.]+\s+)?"([^"]+)"\s*$/gm)) {
      imports.push({ value: match[1], typeOnly: false });
    }
    for (const match of content.matchAll(/^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) {
      imports.push({ value: match[1], typeOnly: false });
    }
    return imports;
  }

  const imports = [];
  for (const match of content.matchAll(/^\s*import\s+(type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["'];?/gm)) {
    imports.push({ value: match[2], typeOnly: Boolean(match[1]) });
  }
  for (const match of content.matchAll(/^\s*import\s*["']([^"']+)["'];?/gm)) {
    imports.push({ value: match[1], typeOnly: false });
  }
  return imports;
}

function resolveFrontendImport(fromPath, specifier) {
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

function frontendFeature(path) {
  const parts = rel(path).split("/");
  if (parts[0] !== "frontend" || parts[1] !== "src" || parts[2] !== "features") {
    return "";
  }
  return parts[3] ?? "";
}

function isFrontendComponent(path) {
  return /\/(components|routes)\//.test(rel(path)) && path.endsWith(".tsx");
}

function backendViolations(path, imports) {
  const file = rel(path);
  const violations = [];
  const inDomain = file.startsWith("backend/internal/domain/");
  const inApplication = file.startsWith("backend/internal/http/application/");

  for (const item of imports) {
    const specifier = item.value;
    if (inDomain && specifier.startsWith("github.com/megu/kaji-challenge/")) {
      violations.push(`${file} imports ${specifier}`);
    }
    if (
      inApplication &&
      (specifier.includes("/backend/internal/openapi/generated") ||
        specifier.includes("/backend/internal/db/sqlc") ||
        specifier.includes("/backend/internal/http/infra") ||
        specifier.includes("/backend/internal/http/transport") ||
        specifier.includes("/backend/internal/http/middleware") ||
        specifier === "github.com/gin-gonic/gin")
    ) {
      violations.push(`${file} imports ${specifier}`);
    }
  }
  return violations;
}

function frontendViolations(path, imports) {
  const file = rel(path);
  const violations = [];
  const feature = frontendFeature(path);
  const inShared = file.startsWith("frontend/src/shared/");

  for (const item of imports) {
    const resolved = resolveFrontendImport(path, item.value);
    if (inShared && resolved.startsWith("frontend/src/features/")) {
      violations.push(`${file} imports ${item.value}`);
    }

    if (feature !== "" && resolved.startsWith("frontend/src/features/")) {
      const parts = resolved.split("/");
      const targetFeature = parts[3] ?? "";
      const targetLayer = parts[4] ?? "";
      if (
        targetFeature !== "" &&
        targetFeature !== feature &&
        ["components", "hooks", "state", "lib"].includes(targetLayer)
      ) {
        violations.push(`${file} imports ${item.value}`);
      }
    }

    if (
      isFrontendComponent(path) &&
      !item.typeOnly &&
      resolved.includes("frontend/src/lib/api/generated/client")
    ) {
      violations.push(`${file} imports ${item.value}`);
    }
  }
  return violations;
}

function loadBaseline() {
  return new Set(
    readFileSync(join(root, "architecture-baseline.txt"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#")),
  );
}

const baseline = loadBaseline();
const violations = [];
for (const path of walk(root)) {
  if (isGenerated(path)) {
    continue;
  }
  const content = readFileSync(path, "utf8");
  const imports = extractImports(path, content);
  violations.push(...backendViolations(path, imports));
  violations.push(...frontendViolations(path, imports));
}

const current = new Set(violations);
const newViolations = [...current].filter((item) => !baseline.has(item)).sort();
const staleBaseline = [...baseline].filter((item) => !current.has(item)).sort();

if (newViolations.length > 0 || staleBaseline.length > 0) {
  if (newViolations.length > 0) {
    console.error("Architecture boundary violations:");
    for (const item of newViolations) {
      console.error(`  ${item}`);
    }
  }
  if (staleBaseline.length > 0) {
    console.error("Stale architecture baseline entries:");
    for (const item of staleBaseline) {
      console.error(`  ${item}`);
    }
  }
  process.exit(1);
}

console.log(`Architecture boundary check passed (${current.size} baseline exceptions).`);
