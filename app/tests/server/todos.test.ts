import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { unstable_splitSqlQuery } from "wrangler";
import { createTestDatabase } from "../helpers/d1";
import { provisionUser } from "../../src/server/application/provision-user";
import { executeOperation } from "../../src/server/application/operations";
import { operationSchema, responseSchemas } from "../../src/contracts/operations";
import type { TodoItem } from "../../src/contracts/models";

it("preserves shopping rows as unclassified ToDos without adding tables or categories", async () => {
  const connection = await createTestDatabase(undefined, "0004_remove_revisions.sql");
  try {
    await connection.query(
      sql`INSERT INTO teams(id,name,created_at) VALUES ('legacy','Legacy','2026-01-01T00:00:00Z'),('empty','Empty','2026-01-01T00:00:00Z')`,
    );
    await connection.query(sql`INSERT INTO shopping_items(id,team_id,name,notes,sort_key,created_at,updated_at)
      VALUES ('milk','legacy','牛乳','2本',200,'2026-01-02T00:00:00Z','2026-01-03T00:00:00Z')`);
    const before = (await connection.query(sql`SELECT * FROM shopping_items`)).rows[0];
    const tablesBefore = (
      await connection.query(sql`SELECT name FROM sqlite_master WHERE type='table'`)
    ).rows;
    const migration = await readFile(
      new URL("../../migrations/0005_todos.sql", import.meta.url),
      "utf8",
    );
    await connection.binding.batch(
      unstable_splitSqlQuery(migration).map((statement) => connection.binding.prepare(statement)),
    );
    expect((await connection.query(sql`SELECT * FROM todo_items`)).rows).toEqual([
      { ...before, category: null },
    ]);
    expect(
      (await connection.query(sql`SELECT todo_categories FROM teams WHERE id='legacy'`)).rows[0],
    ).toEqual({ todo_categories: "[]" });
    expect(
      (await connection.query(sql`SELECT todo_categories FROM teams WHERE id='empty'`)).rows[0],
    ).toEqual({ todo_categories: "[]" });
    const tablesAfter = (
      await connection.query(sql`SELECT name FROM sqlite_master WHERE type='table'`)
    ).rows;
    expect(tablesAfter.map((row) => row.name).sort()).toEqual(
      tablesBefore.map((row) => (row.name === "shopping_items" ? "todo_items" : row.name)).sort(),
    );
  } finally {
    await connection.close();
  }
});

describe("ToDo categories and team boundaries", () => {
  let connection: Awaited<ReturnType<typeof createTestDatabase>>;
  const owner = crypto.randomUUID(),
    outsider = crypto.randomUUID();
  const now = new Date("2026-09-27T00:00:00Z");
  async function run(operation: string, body?: unknown, params = {}, userId = owner) {
    const input = operationSchema.parse({ operation, body, params });
    const result = await executeOperation(connection.repository, input, {
      userId,
      now,
      vapidPublicKey: "",
    });
    return responseSchemas[input.operation].parse(result.data);
  }
  const create = async (name: string, category: string | null, userId = owner) =>
    (await run("postTodoItem", { name, category }, {}, userId)) as TodoItem;
  beforeAll(async () => {
    connection = await createTestDatabase();
    for (const id of [owner, outsider]) {
      await connection.query(
        sql`INSERT INTO auth_user(id,name,email) VALUES (${id},'ToDo tester',${id + "@example.com"})`,
      );
      await provisionUser(connection.repository, id, now);
    }
  });
  afterAll(async () => {
    await connection?.close();
  });

  it("registers free input once, retains empty categories and physically deletes completed items", async () => {
    const item = await create("牛乳", "  買い物リスト  ");
    expect(item.category).toBe("買い物リスト");
    await run("postTodoCategory", { name: "買い物リスト" });
    await run("deleteTodoItem", undefined, { itemId: item.id });
    expect(await run("listTodoCategories")).toEqual({ categories: ["買い物リスト"] });
    expect(
      (await connection.query(sql`SELECT id FROM todo_items WHERE id=${item.id}`)).rows,
    ).toEqual([]);
  });
  it("preserves categories during partial edits and accepts explicit clearing", async () => {
    const item = await create("連絡", "やることリスト");
    expect(await run("patchTodoItem", { notes: "明日" }, { itemId: item.id })).toMatchObject({
      category: "やることリスト",
      notes: "明日",
    });
    expect(await run("patchTodoItem", { category: "連絡先" }, { itemId: item.id })).toMatchObject({
      category: "連絡先",
    });
    expect(await run("patchTodoItem", { category: null }, { itemId: item.id })).toMatchObject({
      category: null,
    });
  });
  it("deletes a used category without deleting ToDos or touching another team", async () => {
    const category = "共通名 ' \" 日本語";
    const own = await create("自分のToDo", category);
    const other = await create("別チームのToDo", category, outsider);
    await expect(
      run("patchTodoItem", { category: "侵入" }, { itemId: other.id }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(run("deleteTodoItem", undefined, { itemId: other.id })).rejects.toMatchObject({
      status: 404,
    });
    await run("deleteTodoCategory", undefined, { name: category });
    expect(await connection.repository.GetTodoItemByID(own.id)).toMatchObject({
      Category: null,
      Name: "自分のToDo",
    });
    expect(await connection.repository.GetTodoItemByID(other.id)).toMatchObject({
      Category: category,
    });
    expect(await run("listTodoCategories", undefined, {}, outsider)).toEqual({
      categories: [category],
    });
    const ownCategories = (await run("listTodoCategories")) as { categories: string[] };
    expect(ownCategories.categories).not.toContain(category);
    expect(ownCategories.categories).not.toContain("侵入");
  });
  it("keeps concurrent category registrations without duplicates or lost updates", async () => {
    await Promise.all(["同時A", "同時B", "同時A"].map((name) => run("postTodoCategory", { name })));
    const { categories } = (await run("listTodoCategories")) as { categories: string[] };
    expect(categories.filter((name) => name === "同時A")).toHaveLength(1);
    expect(categories).toContain("同時B");
  });
  it("keeps registration and item creation atomic on a failed insert", async () => {
    const item = await create("元の項目", null);
    const member = connection.repository.forMember(item.teamId, owner);
    await expect(
      member.CreateTodoItem({
        ID: item.id,
        TeamID: item.teamId,
        Name: "重複ID",
        Notes: null,
        Category: "rollback-only",
        SortKey: 100,
        CreatedAt: now.toISOString(),
        UpdatedAt: now.toISOString(),
      }),
    ).rejects.toThrow();
    const { categories } = (await run("listTodoCategories")) as { categories: string[] };
    expect(categories).not.toContain("rollback-only");
    expect(await member.GetTodoItemByID(item.id)).toMatchObject({
      Name: "元の項目",
      SortKey: 100,
      Category: null,
    });
  });
  it.each(["", "   ", "a".repeat(51)])("rejects invalid category names: %s", (name) => {
    expect(
      operationSchema.safeParse({ operation: "postTodoCategory", body: { name } }).success,
    ).toBe(false);
    expect(
      operationSchema.safeParse({
        operation: "postTodoItem",
        body: { name: "test", category: name },
      }).success,
    ).toBe(false);
  });
});
