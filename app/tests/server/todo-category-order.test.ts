import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { unstable_splitSqlQuery } from "wrangler";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../helpers/d1";
import { provisionUser } from "../../src/server/application/provision-user";
import { executeOperation } from "../../src/server/application/operations";
import { operationSchema, responseSchemas } from "../../src/contracts/operations";
import type { TodoCategoriesResponse } from "../../src/contracts/models";

it("adds only an unclassified sort key while preserving registered categories and ToDos", async () => {
  const connection = await createTestDatabase(undefined, "0005_todos.sql");
  try {
    await connection.query(sql`INSERT INTO teams(id,name,created_at,todo_categories)
      VALUES ('legacy','Legacy','2026-01-01T00:00:00Z','["買い物","仕事"]')`);
    await connection.query(sql`INSERT INTO todo_items(id,team_id,name,category,sort_key,created_at,updated_at)
      VALUES ('milk','legacy','牛乳','買い物',100,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`);
    const before = (await connection.query(sql`SELECT * FROM todo_items`)).rows;
    const migration = await readFile(
      new URL("../../migrations/0006_todo_category_order.sql", import.meta.url),
      "utf8",
    );
    await connection.binding.batch(
      unstable_splitSqlQuery(migration).map((statement) => connection.binding.prepare(statement)),
    );
    expect(
      (
        await connection.query(
          sql`SELECT todo_categories,todo_unclassified_sort_key FROM teams WHERE id='legacy'`,
        )
      ).rows,
    ).toEqual([{ todo_categories: '["買い物","仕事"]', todo_unclassified_sort_key: 0 }]);
    expect((await connection.query(sql`SELECT * FROM todo_items`)).rows).toEqual(before);
    expect(await connection.repository.ListTodoCategories("legacy")).toEqual([
      null,
      "買い物",
      "仕事",
    ]);
    for (const invalidKey of [-1, 3]) {
      await expect(
        connection.query(
          sql`UPDATE teams SET todo_unclassified_sort_key=${invalidKey} WHERE id='legacy'`,
        ),
      ).rejects.toThrow();
    }
  } finally {
    await connection.close();
  }
});

describe("persisted category order", () => {
  let connection: Awaited<ReturnType<typeof createTestDatabase>>;
  const owner = crypto.randomUUID(),
    outsider = crypto.randomUUID();
  const now = new Date("2026-09-27T00:00:00Z");
  let teamId: string, otherTeamId: string;
  async function run(operation: string, body?: unknown, params = {}, userId = owner) {
    const input = operationSchema.parse({ operation, body, params });
    const result = await executeOperation(connection.repository, input, {
      userId,
      now,
      vapidPublicKey: "",
    });
    return responseSchemas[input.operation].parse(result.data);
  }
  const list = async () => ((await run("listTodoCategories")) as TodoCategoriesResponse).categories;
  const reorder = (categories: (string | null)[]) =>
    run("postTodoCategoriesReorder", { categories });
  beforeAll(async () => {
    connection = await createTestDatabase();
    for (const id of [owner, outsider]) {
      await connection.query(
        sql`INSERT INTO auth_user(id,name,email) VALUES (${id},'Category order',${id + "@example.com"})`,
      );
      await provisionUser(connection.repository, id, now);
    }
    teamId = (await connection.repository.ListMembershipsByUserID(owner))[0].TeamID;
    otherTeamId = (await connection.repository.ListMembershipsByUserID(outsider))[0].TeamID;
  });
  beforeEach(async () => {
    await connection.query(
      sql`UPDATE teams SET todo_categories='["A","B","C"]',todo_unclassified_sort_key=0 WHERE id IN (${teamId},${otherTeamId})`,
    );
  });
  afterAll(async () => {
    await connection?.close();
  });

  it.each([
    ["C", null, "A", "B"],
    ["B", "A", "C", null],
    [null, "C", "B", "A"],
  ])(
    "persists a complete order including the virtual unclassified category: %j",
    async (...categories) => {
      expect(await reorder(categories)).toEqual({ categories });
      expect(await list()).toEqual(categories);
      const stored = (
        await connection.query(
          sql`SELECT todo_categories,todo_unclassified_sort_key FROM teams WHERE id=${teamId}`,
        )
      ).rows[0];
      expect(JSON.parse(String(stored.todo_categories))).toEqual(
        categories.filter((name) => name !== null),
      );
      expect(stored.todo_unclassified_sort_key).toBe(categories.indexOf(null));
      expect(await run("listTodoCategories", undefined, {}, outsider)).toEqual({
        categories: [null, "A", "B", "C"],
      });
    },
  );
  it("keeps the other relative positions on deletion and appends new categories", async () => {
    await reorder(["C", "A", null, "B"]);
    await run("deleteTodoCategory", undefined, { name: "C" });
    expect(await list()).toEqual(["A", null, "B"]);
    await run("deleteTodoCategory", undefined, { name: "B" });
    expect(await list()).toEqual(["A", null]);
    await run("deleteTodoCategory", undefined, { name: "missing" });
    expect(await list()).toEqual(["A", null]);
    await run("postTodoCategory", { name: "D" });
    expect(await list()).toEqual(["A", null, "D"]);
    await run("postTodoCategory", { name: "A" });
    expect(await list()).toEqual(["A", null, "D"]);
    await run("deleteTodoCategory", undefined, { name: "A" });
    await run("deleteTodoCategory", undefined, { name: "D" });
    expect(await reorder([null])).toEqual({ categories: [null] });
    await run("postTodoCategory", { name: "First" });
    expect(await list()).toEqual([null, "First"]);
  });
  it.each([
    [null, "A", "B"],
    ["C", null, "A", "B", "D"],
    [null, "A", "B", "other-team-only"],
  ])(
    "rejects a stale or foreign category set without changing storage: %j",
    async (...categories) => {
      await expect(reorder(categories)).rejects.toMatchObject({ status: 409 });
      expect(await list()).toEqual([null, "A", "B", "C"]);
    },
  );
  it("does not lose a concurrently appended category", async () => {
    await Promise.allSettled([
      reorder(["C", "A", "B", null]),
      run("postTodoCategory", { name: "D" }),
    ]);
    const categories = await list();
    expect(categories).toHaveLength(5);
    expect(new Set(categories)).toEqual(new Set([null, "A", "B", "C", "D"]));
    expect(categories.at(-1)).toBe("D");
  });
  it("does not resurrect a concurrently deleted category", async () => {
    await Promise.allSettled([
      reorder(["C", "A", null, "B"]),
      run("deleteTodoCategory", undefined, { name: "C" }),
    ]);
    expect(new Set(await list())).toEqual(new Set([null, "A", "B"]));
  });
  it("checks membership at the write and rejects cross-team and removed membership", async () => {
    expect(
      await connection.repository
        .forMember(otherTeamId, owner)
        .ReorderTodoCategories(otherTeamId, ["C", null, "A", "B"]),
    ).toBe(false);
    const scoped = connection.repository.forMember(teamId, owner);
    await connection.query(
      sql`UPDATE team_members SET team_id=${otherTeamId},role='member' WHERE user_id=${owner}`,
    );
    try {
      expect(await scoped.ReorderTodoCategories(teamId, ["C", null, "A", "B"])).toBe(false);
    } finally {
      await connection.query(
        sql`UPDATE team_members SET team_id=${teamId},role='owner' WHERE user_id=${owner}`,
      );
    }
    expect(await list()).toEqual([null, "A", "B", "C"]);
  });
  it("keeps reserved-looking category names distinct from unclassified", async () => {
    await run("postTodoCategory", { name: "unclassified" });
    await run("postTodoCategory", { name: "未分類" });
    await run("postTodoCategory", { name: '引用 " \\ $' });
    const categories = ["未分類", "unclassified", '引用 " \\ $', "C", null, "A", "B"];
    expect(await reorder(categories)).toEqual({ categories });
  });
});

it.each([
  [],
  ["A"],
  [null, null],
  [null, "A", "A"],
  [null, "A", " A "],
  [null, ""],
  [null, "a".repeat(51)],
])("rejects malformed order input and output: %j", (...categories) => {
  expect(
    operationSchema.safeParse({ operation: "postTodoCategoriesReorder", body: { categories } })
      .success,
  ).toBe(false);
  expect(responseSchemas.listTodoCategories.safeParse({ categories }).success).toBe(false);
});
