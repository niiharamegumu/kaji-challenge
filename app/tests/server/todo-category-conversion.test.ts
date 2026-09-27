import { readFile } from "node:fs/promises";
import { unstable_splitSqlQuery } from "wrangler";
import { describe, expect, it } from "vitest";
import {
  convertTodoCategoryIds,
  type ConversionDatabase,
} from "../../scripts/convert-todo-category-ids";
import { createTestDatabase } from "../helpers/d1";
import { TodoCategoryOrderSchema } from "../../src/contracts/operations";

async function fixture(through = "0006_todo_category_order.sql") {
  const connection = await createTestDatabase(undefined, through);
  const database: ConversionDatabase = {
    batch: (statements) =>
      connection.binding.batch(
        statements.map(({ sql, params = [] }) => connection.binding.prepare(sql).bind(...params)),
      ),
  };
  return {
    ...connection,
    database,
    execute: async (sql: string, ...params: (string | number | null)[]) =>
      connection.binding
        .prepare(sql)
        .bind(...params)
        .all(),
  };
}

describe("explicit category ID conversion", () => {
  it.each([0, 1, 3])(
    "preserves every row and unclassified position %s, is dry-run by default and is idempotent",
    async (position) => {
      const f = await fixture();
      try {
        const names = ["買い物", "仕事", "引用 '\"\\"];
        await f.execute(
          "INSERT INTO teams(id,name,created_at,todo_categories,todo_unclassified_sort_key) VALUES ('legacy','Legacy','now',?,?)",
          JSON.stringify(names),
          position,
        );
        await f.execute("INSERT INTO teams(id,name,created_at) VALUES ('empty','Empty','now')");
        for (const [index, name] of [...names, null].entries()) {
          await f.execute(
            "INSERT INTO todo_items(id,team_id,name,notes,category,sort_key,created_at,updated_at) VALUES (?,'legacy',?,'memo',?,100,'2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z')",
            String(index),
            `ToDo ${index}`,
            name,
          );
        }
        const before = (await f.execute("SELECT * FROM todo_items ORDER BY id")).results;
        expect(await convertTodoCategoryIds(f.database)).toMatchObject({
          converted: 2,
          applied: false,
        });
        expect(
          (await f.execute("SELECT todo_categories FROM teams WHERE id='legacy'")).results[0]
            .todo_categories,
        ).toBe(JSON.stringify(names));
        expect((await f.execute("SELECT * FROM todo_items ORDER BY id")).results).toEqual(before);
        await convertTodoCategoryIds(f.database, true);
        const serialized = (await f.execute("SELECT todo_categories FROM teams WHERE id='legacy'"))
          .results[0].todo_categories;
        const categories = TodoCategoryOrderSchema.parse(JSON.parse(String(serialized)));
        expect(categories.indexOf(null)).toBe(position);
        expect(categories.filter((c) => c !== null).map((c) => c.name)).toEqual(names);
        expect((await f.execute("SELECT * FROM todo_items ORDER BY id")).results).toEqual(
          before.map((row) => ({
            ...row,
            category: categories.find((c) => c?.name === row.category)?.id ?? null,
          })),
        );
        expect(await convertTodoCategoryIds(f.database, true)).toMatchObject({ converted: 0 });
        const migration = await readFile(
          new URL("../../migrations/0007_todo_category_ids.sql", import.meta.url),
          "utf8",
        );
        await f.binding.batch(
          unstable_splitSqlQuery(migration).map((sql) => f.binding.prepare(sql)),
        );
        expect(
          (await f.execute("PRAGMA table_info(teams)")).results.map((c) => c.name),
        ).not.toContain("todo_unclassified_sort_key");
        expect(await f.repository.ListTodoCategories("legacy")).toEqual(categories);
        const after = await f.repository.ListTodoItemsByTeamID("legacy");
        expect(after.map((item) => item.CategoryID)).toEqual(
          before.map((row) => categories.find((c) => c?.name === row.category)?.id ?? null),
        );
        expect(await convertTodoCategoryIds(f.database, true)).toMatchObject({ converted: 0 });
        expect(
          (await f.execute("SELECT todo_categories FROM teams WHERE id='legacy'")).results[0]
            .todo_categories,
        ).toBe(serialized);
        expect((await f.execute("PRAGMA foreign_key_check")).results).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );
  it("supports the deployed schema before sorting was added", async () => {
    const f = await fixture("0005_todos.sql");
    try {
      await f.execute(
        "INSERT INTO teams(id,name,created_at,todo_categories) VALUES ('legacy','Legacy','now','[\"A\"]')",
      );
      await convertTodoCategoryIds(f.database, true);
      const categories = JSON.parse(
        String((await f.execute("SELECT todo_categories FROM teams")).results[0].todo_categories),
      );
      expect(categories).toEqual([null, { id: expect.any(String), name: "A" }]);
    } finally {
      await f.close();
    }
  });
  it("refuses an orphan before writing any team", async () => {
    const f = await fixture();
    try {
      await f.execute(
        "INSERT INTO teams(id,name,created_at,todo_categories) VALUES ('legacy','Legacy','now','[\"A\"]')",
      );
      await f.execute(
        "INSERT INTO todo_items(id,team_id,name,category,sort_key,created_at,updated_at) VALUES ('x','legacy','x','missing',100,'now','now')",
      );
      await expect(convertTodoCategoryIds(f.database, true)).rejects.toThrow("未登録カテゴリー");
      expect(
        (await f.execute("SELECT todo_categories FROM teams")).results[0].todo_categories,
      ).toBe('["A"]');
    } finally {
      await f.close();
    }
  });
  it("refuses to guess the unclassified position if DDL was applied before conversion", async () => {
    const f = await fixture("0007_todo_category_ids.sql");
    try {
      await f.execute(
        "INSERT INTO teams(id,name,created_at,todo_categories) VALUES ('legacy','Legacy','now','[\"A\"]')",
      );
      await expect(convertTodoCategoryIds(f.database, true)).rejects.toThrow("0007適用前");
      expect(
        (await f.execute("SELECT todo_categories FROM teams")).results[0].todo_categories,
      ).toBe('["A"]');
    } finally {
      await f.close();
    }
  });
  it("rolls back the ToDo rewrite if the registry update fails", async () => {
    const f = await fixture();
    try {
      await f.execute(
        "INSERT INTO teams(id,name,created_at,todo_categories) VALUES ('legacy','Legacy','now','[\"A\"]')",
      );
      await f.execute(
        "INSERT INTO todo_items(id,team_id,name,category,sort_key,created_at,updated_at) VALUES ('x','legacy','x','A',100,'now','now')",
      );
      await f.execute(
        "CREATE TRIGGER fail_conversion BEFORE UPDATE ON teams BEGIN SELECT RAISE(ABORT, 'test failure'); END",
      );
      await expect(convertTodoCategoryIds(f.database, true)).rejects.toThrow();
      expect((await f.execute("SELECT category FROM todo_items")).results[0].category).toBe("A");
      expect(
        (await f.execute("SELECT todo_categories FROM teams")).results[0].todo_categories,
      ).toBe('["A"]');
    } finally {
      await f.close();
    }
  });
});
