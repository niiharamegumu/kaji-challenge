import {
  categoryOrderFixture as order,
  categoryIdFixture as cid,
} from "../../src/test/todoCategories";
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
  const list = async () =>
    ((await run("listTodoCategories")) as TodoCategoriesResponse).categories.map(
      (category) => category?.name ?? null,
    );
  const reorder = async (categories: (string | null)[]) => {
    const current = ((await run("listTodoCategories")) as TodoCategoriesResponse).categories;
    return run("postTodoCategoriesReorder", {
      categoryIds: categories.map((name) =>
        name === null
          ? null
          : (current.find((category) => category?.name === name)?.id ?? cid(name)),
      ),
    });
  };
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
      sql`UPDATE teams SET todo_categories=${JSON.stringify(order(null, "A", "B", "C"))} WHERE id IN (${teamId},${otherTeamId})`,
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
      expect(await reorder(categories)).toEqual({ categories: order(...categories) });
      expect(await list()).toEqual(categories);
      const stored = (
        await connection.query(sql`SELECT todo_categories FROM teams WHERE id=${teamId}`)
      ).rows[0];
      expect(JSON.parse(String(stored.todo_categories))).toEqual(order(...categories));
      expect(await run("listTodoCategories", undefined, {}, outsider)).toEqual({
        categories: order(null, "A", "B", "C"),
      });
    },
  );
  it("keeps the other relative positions on deletion and appends new categories", async () => {
    await reorder(["C", "A", null, "B"]);
    await run("deleteTodoCategory", undefined, { categoryId: cid("C") });
    expect(await list()).toEqual(["A", null, "B"]);
    await run("deleteTodoCategory", undefined, { categoryId: cid("B") });
    expect(await list()).toEqual(["A", null]);
    await expect(
      run("deleteTodoCategory", undefined, { categoryId: cid("missing") }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await list()).toEqual(["A", null]);
    await run("postTodoCategory", { name: "D" });
    expect(await list()).toEqual(["A", null, "D"]);
    await run("postTodoCategory", { name: "A" });
    expect(await list()).toEqual(["A", null, "D"]);
    await run("deleteTodoCategory", undefined, { categoryId: cid("A") });
    await run("deleteTodoCategory", undefined, {
      categoryId: ((await run("listTodoCategories")) as TodoCategoriesResponse).categories.find(
        (c) => c?.name === "D",
      )!.id,
    });
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
      run("deleteTodoCategory", undefined, { categoryId: cid("C") }),
    ]);
    expect(new Set(await list())).toEqual(new Set([null, "A", "B"]));
  });
  it("checks membership at the write and rejects cross-team and removed membership", async () => {
    expect(
      await connection.repository
        .forMember(otherTeamId, owner)
        .ReorderTodoCategories(otherTeamId, [cid("C"), null, cid("A"), cid("B")]),
    ).toBe(false);
    const scoped = connection.repository.forMember(teamId, owner);
    await connection.query(
      sql`UPDATE team_members SET team_id=${otherTeamId},role='member' WHERE user_id=${owner}`,
    );
    try {
      expect(await scoped.ReorderTodoCategories(teamId, [cid("C"), null, cid("A"), cid("B")])).toBe(
        false,
      );
    } finally {
      await connection.query(
        sql`UPDATE team_members SET team_id=${teamId},role='owner' WHERE user_id=${owner}`,
      );
    }
    expect(await list()).toEqual([null, "A", "B", "C"]);
  });
  it("preserves renamed labels and ToDo references when saving an order captured before the rename", async () => {
    const categoryIds = [cid("B"), null, cid("C"), cid("A")];
    const created = responseSchemas.postTodoItem.parse(
      await run("postTodoItem", { name: "牛乳", categoryId: cid("A") }),
    );
    const before = await connection.repository.GetTodoItemByID(created.id);
    expect(
      await run("patchTodoCategory", { name: " 新しい名前 " }, { categoryId: cid("A") }),
    ).toEqual({
      categories: [null, { id: cid("A"), name: "新しい名前" }, ...order("B", "C")],
    });
    expect(await connection.repository.GetTodoItemByID(created.id)).toEqual(before);
    expect(await run("postTodoCategoriesReorder", { categoryIds })).toEqual({
      categories: [...order("B", null, "C"), { id: cid("A"), name: "新しい名前" }],
    });
    expect((await connection.repository.GetTodoItemByID(created.id)).CategoryID).toBe(cid("A"));
  });
  it("rejects a stale ID even when the category is recreated under the same name", async () => {
    await run("deleteTodoCategory", undefined, { categoryId: cid("A") });
    await run("postTodoCategory", { name: "A" });
    await expect(
      run("postTodoCategoriesReorder", { categoryIds: [cid("A"), null, cid("B"), cid("C")] }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await list()).toEqual([null, "B", "C", "A"]);
  });
  it("rejects duplicate, missing and foreign IDs without changing either team", async () => {
    await expect(
      run("patchTodoCategory", { name: " B " }, { categoryId: cid("A") }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      run("patchTodoCategory", { name: "Missing" }, { categoryId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    const foreignId = crypto.randomUUID();
    await connection.repository.CreateTodoCategory(otherTeamId, { id: foreignId, name: "Other" });
    const otherBefore = await connection.repository.ListTodoCategories(otherTeamId);
    await expect(
      run("patchTodoCategory", { name: "Changed" }, { categoryId: foreignId }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await connection.repository
        .forMember(otherTeamId, owner)
        .RenameTodoCategory(otherTeamId, cid("A"), "Changed"),
    ).toBe(false);
    expect(await list()).toEqual([null, "A", "B", "C"]);
    expect(await connection.repository.ListTodoCategories(otherTeamId)).toEqual(otherBefore);
  });
  it("checks membership again when renaming and never revives a deleted ID", async () => {
    const scoped = connection.repository.forMember(teamId, owner);
    await connection.query(
      sql`UPDATE team_members SET team_id=${otherTeamId},role='member' WHERE user_id=${owner}`,
    );
    try {
      expect(await scoped.RenameTodoCategory(teamId, cid("A"), "Changed")).toBe(false);
    } finally {
      await connection.query(
        sql`UPDATE team_members SET team_id=${teamId},role='owner' WHERE user_id=${owner}`,
      );
    }
    expect(await list()).toEqual([null, "A", "B", "C"]);
    await run("deleteTodoCategory", undefined, { categoryId: cid("A") });
    await run("postTodoCategory", { name: "A" });
    await expect(
      run("patchTodoCategory", { name: "Changed" }, { categoryId: cid("A") }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await list()).toEqual([null, "B", "C", "A"]);
  });
  it("allows the same name and safely stores quotes and reserved-looking names", async () => {
    for (const name of ["A", '引用 " \\ $', "未分類"]) {
      const result = responseSchemas.patchTodoCategory.parse(
        await run("patchTodoCategory", { name }, { categoryId: cid("A") }),
      );
      expect(result.categories).toEqual([null, { id: cid("A"), name }, ...order("B", "C")]);
    }
  });
  it("preserves concurrent additions and reordering while renaming by ID", async () => {
    await Promise.all([
      run("patchTodoCategory", { name: "Renamed" }, { categoryId: cid("A") }),
      run("postTodoCategoriesReorder", { categoryIds: [cid("C"), cid("A"), null, cid("B")] }),
    ]);
    expect(await list()).toEqual(["C", "Renamed", null, "B"]);
    await Promise.all([
      run("patchTodoCategory", { name: "Updated" }, { categoryId: cid("A") }),
      run("postTodoCategory", { name: "D" }),
    ]);
    expect(await list()).toEqual(["C", "Updated", null, "B", "D"]);
  });
  it("rejects concurrent duplicate renames and preserves concurrent deletions", async () => {
    const results = await Promise.allSettled(
      ["A", "B"].map((name) =>
        run("patchTodoCategory", { name: "Same" }, { categoryId: cid(name) }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await list()).filter((name) => name === "Same")).toHaveLength(1);
    await Promise.allSettled([
      run("patchTodoCategory", { name: "Renamed" }, { categoryId: cid("C") }),
      run("deleteTodoCategory", undefined, { categoryId: cid("C") }),
    ]);
    const categories = responseSchemas.listTodoCategories.parse(
      await run("listTodoCategories"),
    ).categories;
    expect(categories.some((category) => category?.id === cid("C"))).toBe(false);
  });
  it("keeps reserved-looking category names distinct from unclassified", async () => {
    await run("postTodoCategory", { name: "unclassified" });
    await run("postTodoCategory", { name: "未分類" });
    await run("postTodoCategory", { name: '引用 " \\ $' });
    const categories = ["未分類", "unclassified", '引用 " \\ $', "C", null, "A", "B"];
    await reorder(categories);
    expect(await list()).toEqual(categories);
  });
});

it.each([
  { categoryId: cid("A"), name: " " },
  { categoryId: cid("A"), name: "a".repeat(51) },
  { categoryId: null, name: "未分類" },
  { categoryId: "A", name: "Name" },
])("rejects malformed rename input: %j", ({ categoryId, name }) => {
  expect(
    operationSchema.safeParse({
      operation: "patchTodoCategory",
      params: { categoryId },
      body: { name },
    }).success,
  ).toBe(false);
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
    operationSchema.safeParse({
      operation: "postTodoCategoriesReorder",
      body: { categoryIds: categories },
    }).success,
  ).toBe(false);
  expect(responseSchemas.listTodoCategories.safeParse({ categories }).success).toBe(false);
});

it.each([[cid("A")], [null, cid("A"), cid("A")], [null, null, cid("A")]])(
  "rejects malformed null/duplicate structure even with valid UUIDs: %j",
  (...categoryIds) => {
    expect(
      operationSchema.safeParse({ operation: "postTodoCategoriesReorder", body: { categoryIds } })
        .success,
    ).toBe(false);
    expect(
      responseSchemas.listTodoCategories.safeParse({
        categories: categoryIds.map((id) => (id === null ? null : { id, name: "A" })),
      }).success,
    ).toBe(false);
  },
);
