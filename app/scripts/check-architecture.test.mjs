import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { extractImports, violationsFor } from "./check-architecture.mjs";

const violations = (file, content) =>
  violationsFor(
    fileURLToPath(new URL(`../src/${file}`, import.meta.url)),
    extractImports(content, file),
  );

test("does not interpret TypeScript generics or assertions as JSX before an import", () => {
  for (const expression of [
    "const identity = <T>(value: T) => value;",
    "const text = <string>value;",
  ])
    assert.equal(
      violations(
        "features/home/example.ts",
        `${expression}\nimport { value } from "../todos/utils/value";`,
      ).length,
      1,
    );
  assert.equal(
    violations(
      "features/home/example.tsx",
      'const view = <div />; const load = () => import("../todos/utils/value");',
    ).length,
    1,
  );
});

test("parses real imports and re-exports without treating comments or text as dependencies", () => {
  assert.deepEqual(
    extractImports(`
      // import { fake } from "fake-comment";
      const text = 'import("fake-string")';
      import {
        value,
        type Shape,
      } from "values";
      import { type OnlyType } from "types";
      import "side-effect";
      export { value } from "barrel";
      export * from "all";
      export type { Shape } from "type-barrel";
      export { type OnlyType } from "named-types";
      const load = () => import("dynamic");
      type Result = import("type-query").Result;
    `),
    [
      { value: "values", typeOnly: false },
      { value: "types", typeOnly: true },
      { value: "side-effect", typeOnly: false },
      { value: "barrel", typeOnly: false },
      { value: "all", typeOnly: false },
      { value: "type-barrel", typeOnly: true },
      { value: "named-types", typeOnly: true },
      { value: "dynamic", typeOnly: false },
      { value: "type-query", typeOnly: true },
    ],
  );
});

for (const layer of [
  "components",
  "hooks",
  "state",
  "lib",
  "api",
  "model",
  "routes",
  "utils",
  "constants",
])
  test(`requires another feature's ${layer} to be accessed through its public API`, () => {
    assert.equal(
      violations("features/home/example.ts", `import { value } from "../todos/${layer}/value";`)
        .length,
      1,
    );
    assert.equal(
      violations("features/home/example.ts", `export { value } from "../todos/${layer}/value";`)
        .length,
      1,
    );
  });

test("allows feature public APIs and same-feature implementation imports", () => {
  for (const target of ["../todos", "../todos/index", "../todos/index.ts", "./utils/date"])
    assert.deepEqual(
      violations("features/home/example.ts", `import { value } from "${target}";`),
      [],
    );
});

test("enforces server and shared boundaries through re-exports and dynamic imports", () => {
  assert.equal(violations("shared/example.ts", 'export * from "../features/todos";').length, 1);
  assert.equal(
    violations(
      "features/home/example.ts",
      'export * from "../../server/infrastructure/repository";',
    ).length,
    1,
  );
  assert.equal(
    violations("server/application/example.ts", 'const load = () => import("drizzle-orm");').length,
    1,
  );
  assert.deepEqual(
    violations(
      "features/home/example.ts",
      'import { type Repository } from "../../server/application/ports";',
    ),
    [],
  );
});
