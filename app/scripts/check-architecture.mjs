// `architecture:check` から実行し、src/ の層・feature間のimport規約違反を検出する。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));

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

export function extractImports(content, fileName = "source.ts") {
  const imports = [];
  const source = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const add = (specifier, typeOnly) => {
    if (specifier && ts.isStringLiteralLike(specifier))
      imports.push({ value: specifier.text, typeOnly });
  };
  const onlyTypes = (bindings) =>
    bindings?.elements?.length > 0 && bindings.elements.every((item) => item.isTypeOnly);
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      add(
        node.moduleSpecifier,
        Boolean(clause?.isTypeOnly || (!clause?.name && onlyTypes(clause?.namedBindings))),
      );
    } else if (ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier, Boolean(node.isTypeOnly || onlyTypes(node.exportClause)));
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, true);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression, node.isTypeOnly);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      add(node.arguments[0], false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
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

export function violationsFor(path, imports) {
  const file = rel(path);
  const violations = [];
  const sourceFeature = feature(path);
  const inShared = file.startsWith("src/shared/");

  for (const item of imports) {
    const resolved = resolveImport(path, item.value);
    const inCore = /^src\/server\/(application|domain)\//.test(file);
    if (
      inCore &&
      (/^(react|@tanstack|drizzle-orm|better-auth|cloudflare:|agents(?:\/|$)|@modelcontextprotocol\/|@cloudflare\/workers-oauth-provider)/.test(
        resolved,
      ) ||
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
      if (
        targetFeature !== "" &&
        targetFeature !== sourceFeature &&
        !/^src\/features\/[^/]+(?:\/index(?:\.tsx?)?)?$/.test(resolved)
      ) {
        violations.push(`${file} imports ${item.value}`);
      }
    }
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = [];
  for (const path of walk(join(root, "src"))) {
    violations.push(...violationsFor(path, extractImports(readFileSync(path, "utf8"), path)));
  }
  if (violations.length) {
    console.error("Application dependency boundary violations:");
    for (const violation of new Set(violations)) console.error(`  ${violation}`);
    process.exitCode = 1;
  } else console.log("Application architecture boundary check passed.");
}
