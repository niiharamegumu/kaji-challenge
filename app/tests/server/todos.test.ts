import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { unstable_splitSqlQuery } from "wrangler";
import { createTestDatabase } from "../helpers/d1";
import { provisionUser } from "../../src/server/application/provision-user";
import { executeOperation } from "../../src/server/application/operations";
import { operationSchema, responseSchemas } from "../../src/contracts/operations";
import type { TodoItem, TodoCategoriesResponse } from "../../src/contracts/models";

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
  const register = async (name: string, userId = owner) => {
    const response = (await run(
      "postTodoCategory",
      { name },
      {},
      userId,
    )) as TodoCategoriesResponse;
    return response.categories.find((category) => category?.name === name.trim())!;
  };
  const create = async (name: string, category: string | null, userId = owner) =>
    (await run(
      "postTodoItem",
      { name, categoryId: category === null ? null : (await register(category, userId)).id },
      {},
      userId,
    )) as TodoItem;
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

  it("registers categories once, retains empty categories and physically deletes completed items", async () => {
    const item = await create("牛乳", "  買い物リスト  ");
    expect(item.categoryId).toBe((await register("買い物リスト")).id);
    await run("postTodoCategory", { name: "買い物リスト" });
    await run("deleteTodoItem", undefined, { itemId: item.id });
    expect(await run("listTodoCategories")).toEqual({
      categories: [null, await register("買い物リスト")],
    });
    expect(
      (await connection.query(sql`SELECT id FROM todo_items WHERE id=${item.id}`)).rows,
    ).toEqual([]);
  });
  it("preserves categories during partial edits and accepts explicit clearing", async () => {
    const item = await create("連絡", "やることリスト");
    expect(await run("patchTodoItem", { notes: "明日" }, { itemId: item.id })).toMatchObject({
      categoryId: item.categoryId,
      notes: "明日",
    });
    expect(
      await run(
        "patchTodoItem",
        { categoryId: (await register("連絡先")).id },
        { itemId: item.id },
      ),
    ).toMatchObject({
      categoryId: (await register("連絡先")).id,
    });
    expect(await run("patchTodoItem", { categoryId: null }, { itemId: item.id })).toMatchObject({
      categoryId: null,
    });
  });
  it("deletes a used category without deleting ToDos or touching another team", async () => {
    const category = "共通名 ' \" 日本語";
    const own = await create("自分のToDo", category);
    const other = await create("別チームのToDo", category, outsider);
    await expect(
      run("patchTodoItem", { categoryId: crypto.randomUUID() }, { itemId: other.id }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(run("deleteTodoItem", undefined, { itemId: other.id })).rejects.toMatchObject({
      status: 404,
    });
    await run("deleteTodoCategory", undefined, { categoryId: own.categoryId });
    expect(await connection.repository.GetTodoItemByID(own.id)).toMatchObject({
      CategoryID: null,
      Name: "自分のToDo",
    });
    expect(await connection.repository.GetTodoItemByID(other.id)).toMatchObject({
      CategoryID: other.categoryId,
    });
    expect(await run("listTodoCategories", undefined, {}, outsider)).toEqual({
      categories: [null, { id: other.categoryId, name: category }],
    });
    const ownCategories = (await run("listTodoCategories")) as TodoCategoriesResponse;
    expect(ownCategories.categories.map((category) => category?.id)).not.toContain(own.categoryId);
    expect(ownCategories.categories.map((category) => category?.name)).not.toContain("侵入");
  });
  it("keeps concurrent category registrations without duplicates or lost updates", async () => {
    await Promise.all(["同時A", "同時B", "同時A"].map((name) => run("postTodoCategory", { name })));
    const { categories } = (await run("listTodoCategories")) as TodoCategoriesResponse;
    expect(categories.filter((category) => category?.name === "同時A")).toHaveLength(1);
    expect(categories.map((category) => category?.name)).toContain("同時B");
  });
  it("keeps item order unchanged on a failed insert", async () => {
    const item = await create("元の項目", null);
    const member = connection.repository.forMember(item.teamId, owner);
    await expect(
      member.CreateTodoItem({
        ID: item.id,
        TeamID: item.teamId,
        Name: "重複ID",
        Notes: null,
        CategoryID: null,
        SortKey: 100,
        CreatedAt: now.toISOString(),
        UpdatedAt: now.toISOString(),
      }),
    ).rejects.toThrow();
    expect(await member.GetTodoItemByID(item.id)).toMatchObject({
      Name: "元の項目",
      SortKey: 100,
      CategoryID: null,
    });
  });
  it("rejects foreign and deleted IDs without changing item order or content", async () => {
    const foreign = await register("別チーム専用", outsider);
    const deleted = await register("削除済み");
    await run("deleteTodoCategory", undefined, { categoryId: deleted.id });
    const item = await create("変更しない", null);
    const before = await connection.repository.ListTodoItemsByTeamID(item.teamId);
    for (const categoryId of [foreign.id, deleted.id]) {
      await expect(run("postTodoItem", { name: "拒否する", categoryId })).rejects.toMatchObject({
        status: 409,
      });
      await expect(
        run("patchTodoItem", { name: "拒否する", categoryId }, { itemId: item.id }),
      ).rejects.toMatchObject({ status: 409 });
    }
    expect(await connection.repository.ListTodoItemsByTeamID(item.teamId)).toEqual(before);
  });
  it("does not relink an unclassified ToDo when a category is recreated with the same name", async () => {
    const item = await create("再分類しない", "再作成");
    await run("deleteTodoCategory", undefined, { categoryId: item.categoryId });
    const replacement = await register("再作成");
    expect(replacement.id).not.toBe(item.categoryId);
    expect((await connection.repository.GetTodoItemByID(item.id)).CategoryID).toBeNull();
  });
  it("keeps references valid when deletion races a ToDo create or edit", async () => {
    for (const editing of [false, true]) {
      const category = await register("並行削除");
      const existing = await create("編集元", null);
      await Promise.allSettled([
        editing
          ? run("patchTodoItem", { categoryId: category.id }, { itemId: existing.id })
          : run("postTodoItem", { name: "同時追加", categoryId: category.id }),
        run("deleteTodoCategory", undefined, { categoryId: category.id }),
      ]);
      const rows = await connection.repository.ListTodoItemsByTeamID(existing.teamId);
      expect(rows.some((row) => row.CategoryID === category.id)).toBe(false);
    }
  });
  it.each(["", "   ", "a".repeat(51)])("rejects invalid category names: %s", (name) => {
    expect(
      operationSchema.safeParse({ operation: "postTodoCategory", body: { name } }).success,
    ).toBe(false);
    expect(
      operationSchema.safeParse({
        operation: "postTodoItem",
        body: { name: "test", categoryId: name },
      }).success,
    ).toBe(false);
  });
});
