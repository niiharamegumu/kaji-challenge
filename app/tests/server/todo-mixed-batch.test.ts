import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { provisionUser } from "../../src/server/application/provision-user";
import { createTestDatabase } from "../helpers/d1";

let connection: Awaited<ReturnType<typeof createTestDatabase>>;
let userId: string, sessionId: string, teamId: string, categoryId: string;
beforeAll(async () => {
  connection = await createTestDatabase();
});
afterAll(async () => {
  await connection?.close();
});
beforeEach(async () => {
  userId = crypto.randomUUID();
  sessionId = crypto.randomUUID();
  categoryId = crypto.randomUUID();
  await connection.query(
    sql`INSERT INTO auth_user(id,name,email) VALUES (${userId},'Mixed',${userId + "@example.com"})`,
  );
  await provisionUser(connection.repository, userId, new Date());
  teamId = (await connection.repository.ListMembershipsByUserID(userId))[0].TeamID;
  await connection.query(
    sql`INSERT INTO auth_session(id,token,user_id,expires_at) VALUES (${sessionId},${sessionId},${userId},${new Date(Date.now() + 120000).toISOString()})`,
  );
  await connection.repository.CreateTodoCategory(teamId, { id: categoryId, name: "買い物" });
  await connection.repository.CreateTodoItemsAtomic([row("塩"), row("塩"), row("そのまま")]);
});
const row = (Name: string, CategoryID: string | null = categoryId) => ({
  ID: crypto.randomUUID(),
  TeamID: teamId,
  Name,
  Notes: null,
  CategoryID,
  SortKey: 100,
  CreatedAt: new Date().toISOString(),
  UpdatedAt: new Date().toISOString(),
});
const scoped = () => connection.repository.forSession(userId, sessionId).forMember(teamId, userId);
const items = () => connection.repository.ListTodoItemsByTeamID(teamId);

it("commits all mixed commands and returns read snapshots in command order", async () => {
  const result = await scoped().ApplyTodoAssistActionsAtomic(teamId, [
    { kind: "remove", names: ["塩"] },
    { kind: "add", items: [row("レモン")] },
    { kind: "list" },
    { kind: "remove", names: ["レモン"] },
    { kind: "list" },
  ]);
  expect(result).toMatchObject([
    { kind: "remove", count: 2 },
    { kind: "add", items: [{ Name: "レモン" }] },
    { kind: "list", items: [{ Name: "レモン" }, { Name: "そのまま" }] },
    { kind: "remove", count: 1 },
    { kind: "list", items: [{ Name: "そのまま" }] },
  ]);
  expect((await items()).map((item) => item.Name)).toEqual(["そのまま"]);
});
it("rolls back an earlier completion and all sort shifts if a later insert fails", async () => {
  const before = await items();
  const conflict = before.find((item) => item.Name === "そのまま")!;
  await expect(
    scoped().ApplyTodoAssistActionsAtomic(teamId, [
      { kind: "remove", names: ["塩"] },
      { kind: "add", items: [{ ...row("レモン"), ID: conflict.ID }] },
    ]),
  ).rejects.toThrow();
  expect(await items()).toEqual(before);
});
it("checks categories for the entire batch before an earlier removal can change data", async () => {
  const before = await items();
  expect(
    await scoped().ApplyTodoAssistActionsAtomic(teamId, [
      { kind: "remove", names: ["塩"] },
      { kind: "add", items: [row("レモン", crypto.randomUUID())] },
    ]),
  ).toMatchObject([
    { kind: "remove", count: 0 },
    { kind: "add", items: [] },
  ]);
  expect(await items()).toEqual(before);
});
it.each(["session", "membership"])(
  "denies every mixed operation if %s is revoked after scope creation",
  async (boundary) => {
    const repository = scoped();
    const before = await items();
    if (boundary === "session")
      await connection.query(sql`DELETE FROM auth_session WHERE id=${sessionId}`);
    else await connection.query(sql`DELETE FROM team_members WHERE user_id=${userId}`);
    expect(
      await repository.ApplyTodoAssistActionsAtomic(teamId, [
        { kind: "remove", names: ["塩"] },
        { kind: "add", items: [row("レモン")] },
        { kind: "list" },
      ]),
    ).toMatchObject([{ count: 0 }, { items: [] }, { items: [] }]);
    expect(await items()).toEqual(before);
  },
);
it("rejects foreign team rows and excessive batches without changing data", async () => {
  const before = await items();
  expect(
    await scoped().ApplyTodoAssistActionsAtomic(teamId, [
      { kind: "remove", names: ["塩"] },
      { kind: "add", items: [{ ...row("レモン"), TeamID: crypto.randomUUID() }] },
    ]),
  ).toEqual([]);
  expect(
    await scoped().ApplyTodoAssistActionsAtomic(
      teamId,
      Array.from({ length: 11 }, () => ({ kind: "remove", names: ["塩"] })),
    ),
  ).toEqual([]);
  expect(await items()).toEqual(before);
});
it("counts concurrent completions once and preserves both additions", async () => {
  const results = await Promise.all(
    ["レモン", "みかん"].map((name) =>
      scoped().ApplyTodoAssistActionsAtomic(teamId, [
        { kind: "remove", names: ["塩"] },
        { kind: "add", items: [row(name)] },
      ]),
    ),
  );
  expect(
    results.reduce(
      (total, result) => total + (result[0].kind === "remove" ? result[0].count : 0),
      0,
    ),
  ).toBe(2);
  expect((await items()).map((item) => item.Name).sort()).toEqual(
    ["そのまま", "みかん", "レモン"].sort(),
  );
});
