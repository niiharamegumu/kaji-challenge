import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionUser } from "../../src/server/application/provision-user";
import { createTestDatabase } from "../helpers/d1";

describe("atomic ToDo batch creation", () => {
  let connection: Awaited<ReturnType<typeof createTestDatabase>>;
  let userId: string, sessionId: string, teamId: string, categoryId: string;
  const now = new Date().toISOString();
  beforeAll(async () => {
    connection = await createTestDatabase();
  });
  beforeEach(async () => {
    userId = crypto.randomUUID();
    sessionId = crypto.randomUUID();
    categoryId = crypto.randomUUID();
    await connection.query(
      sql`INSERT INTO auth_user(id,name,email) VALUES (${userId},'Batch',${userId + "@example.com"})`,
    );
    await provisionUser(connection.repository, userId, new Date());
    teamId = (await connection.repository.ListMembershipsByUserID(userId))[0].TeamID;
    await connection.query(
      sql`INSERT INTO auth_session(id,token,user_id,expires_at) VALUES (${sessionId},${sessionId},${userId},${new Date(Date.now() + 120000).toISOString()})`,
    );
    await connection.repository.CreateTodoCategory(teamId, { id: categoryId, name: "買い物" });
    await connection.repository.CreateTodoItem(row("Existing", null));
  });
  afterAll(async () => {
    await connection?.close();
  });
  const row = (name: string, targetCategoryId: string | null = categoryId) => ({
    ID: crypto.randomUUID(),
    TeamID: teamId,
    Name: name,
    Notes: null,
    CategoryID: targetCategoryId,
    SortKey: 100,
    CreatedAt: now,
    UpdatedAt: now,
  });
  const scoped = () =>
    connection.repository.forSession(userId, sessionId).forMember(teamId, userId);
  const items = () => connection.repository.ListTodoItemsByTeamID(teamId);

  it("prepends the complete batch in spoken order and shifts old items once", async () => {
    const result = await scoped().CreateTodoItemsAtomic([row("牛乳"), row("卵"), row("洗剤")]);
    expect(result.map((item) => item.Name)).toEqual(["牛乳", "卵", "洗剤"]);
    expect((await items()).map((item) => [item.Name, item.SortKey])).toEqual([
      ["牛乳", 100],
      ["卵", 200],
      ["洗剤", 300],
      ["Existing", 400],
    ]);
  });
  it("rejects the entire batch when any category is missing, without shifting existing items", async () => {
    const before = await items();
    const result = await scoped().CreateTodoItemsAtomic([
      row("Valid"),
      row("Unknown", crypto.randomUUID()),
    ]);
    expect(result).toEqual([]);
    expect(await items()).toEqual(before);
  });
  it("saves 50 items in different categories without exceeding D1's bind limit", async () => {
    const requested = [];
    for (let i = 0; i < 50; i++) {
      const id = crypto.randomUUID();
      await connection.repository.CreateTodoCategory(teamId, { id, name: `分類${i}` });
      requested.push(row(`必要なもの${i}`, id));
    }
    const saved = await scoped().CreateTodoItemsAtomic(requested);
    expect(saved.map((item) => item.Name)).toEqual(requested.map((item) => item.Name));
    expect(saved.map((item) => item.CategoryID)).toEqual(requested.map((item) => item.CategoryID));
    expect(await items()).toHaveLength(51);
    const before = await items();
    expect(await scoped().CreateTodoItemsAtomic([...requested, row("51件目")])).toEqual([]);
    expect(await items()).toEqual(before);
  });
  it("rechecks categories at the SQL boundary after deletion", async () => {
    const repository = scoped();
    const requested = [row("Unclassified", null), row("Deleted category")];
    await repository.DeleteTodoCategory(teamId, categoryId, now);
    const before = await items();
    expect(await repository.CreateTodoItemsAtomic(requested)).toEqual([]);
    expect(await items()).toEqual(before);
  });
  it.each(["session", "membership"] as const)(
    "rejects all writes after the scoped %s is revoked",
    async (boundary) => {
      const repository = scoped();
      const before = await items();
      if (boundary === "session")
        await connection.query(sql`DELETE FROM auth_session WHERE id=${sessionId}`);
      else await connection.query(sql`DELETE FROM team_members WHERE user_id=${userId}`);
      expect(await repository.CreateTodoItemsAtomic([row("牛乳"), row("卵")])).toEqual([]);
      expect(await items()).toEqual(before);
    },
  );
  it("rolls back all inserted items and the sort shift if one row fails", async () => {
    const before = await items();
    await expect(
      scoped().CreateTodoItemsAtomic([
        row("First"),
        { ...row("Conflicting ID"), ID: before[0].ID },
      ]),
    ).rejects.toThrow();
    expect(await items()).toEqual(before);
  });
  it("rejects a foreign team or mixed team IDs without touching either team", async () => {
    const foreignUser = crypto.randomUUID();
    await connection.query(
      sql`INSERT INTO auth_user(id,name,email) VALUES (${foreignUser},'Other',${foreignUser + "@example.com"})`,
    );
    await provisionUser(connection.repository, foreignUser, new Date());
    const foreignTeam = (await connection.repository.ListMembershipsByUserID(foreignUser))[0]
      .TeamID;
    const before = await items();
    const foreignRow = { ...row("Foreign", null), TeamID: foreignTeam };
    expect(await scoped().CreateTodoItemsAtomic([foreignRow])).toEqual([]);
    expect(await scoped().CreateTodoItemsAtomic([row("Local"), foreignRow])).toEqual([]);
    expect(await items()).toEqual(before);
    expect(await connection.repository.ListTodoItemsByTeamID(foreignTeam)).toEqual([]);
  });
  it("keeps two concurrent batches complete and ordered without lost inserts", async () => {
    await Promise.all([
      scoped().CreateTodoItemsAtomic([row("A1"), row("A2")]),
      scoped().CreateTodoItemsAtomic([row("B1"), row("B2")]),
    ]);
    const saved = await items();
    expect(saved.map((item) => item.SortKey)).toEqual([100, 200, 300, 400, 500]);
    expect(saved.map((item) => item.Name)).toEqual(
      expect.arrayContaining(["A1", "A2", "B1", "B2", "Existing"]),
    );
    const names = saved.map((item) => item.Name);
    expect(names.indexOf("A2")).toBe(names.indexOf("A1") + 1);
    expect(names.indexOf("B2")).toBe(names.indexOf("B1") + 1);
  });
});
