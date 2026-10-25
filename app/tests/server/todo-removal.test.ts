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
    sql`INSERT INTO auth_user(id,name,email) VALUES (${userId},'Removal',${userId + "@example.com"})`,
  );
  await provisionUser(connection.repository, userId, new Date());
  teamId = (await connection.repository.ListMembershipsByUserID(userId))[0].TeamID;
  await connection.query(
    sql`INSERT INTO auth_session(id,token,user_id,expires_at) VALUES (${sessionId},${sessionId},${userId},${new Date(Date.now() + 120000).toISOString()})`,
  );
  await connection.repository.CreateTodoCategory(teamId, { id: categoryId, name: "買い物" });
});
const row = (name: string, category: string | null = categoryId) => ({
  ID: crypto.randomUUID(),
  TeamID: teamId,
  Name: name,
  Notes: null,
  CategoryID: category,
  SortKey: 100,
  CreatedAt: new Date().toISOString(),
  UpdatedAt: new Date().toISOString(),
});
const scoped = () => connection.repository.forSession(userId, sessionId).forMember(teamId, userId);
const items = () => connection.repository.ListTodoItemsByTeamID(teamId);

it("removes all exact-name duplicates within category scope and treats SQL-like names literally", async () => {
  const injected = "x' OR 1=1 --";
  await scoped().CreateTodoItemsAtomic([
    row("牛乳"),
    row("牛乳"),
    row("牛乳", null),
    row("低脂肪牛乳"),
    row(injected),
  ]);
  expect(await scoped().DeleteTodoItemsByNames(teamId, ["牛乳"], categoryId)).toBe(2);
  expect((await items()).map((item) => item.Name)).toEqual(["牛乳", "低脂肪牛乳", injected]);
  expect(await scoped().DeleteTodoItemsByNames(teamId, [injected])).toBe(1);
  expect(await scoped().DeleteTodoItemsByNames(teamId, ["牛乳"], null)).toBe(1);
  expect(await scoped().DeleteTodoItemsByNames(teamId, [])).toBe(0);
  expect((await items()).map((item) => item.Name)).toEqual(["低脂肪牛乳"]);
});
it("keeps both teams unchanged for a foreign team even when full names match", async () => {
  await scoped().CreateTodoItemsAtomic([row("牛乳")]);
  const otherUser = crypto.randomUUID();
  await connection.query(
    sql`INSERT INTO auth_user(id,name,email) VALUES (${otherUser},'Other',${otherUser + "@example.com"})`,
  );
  await provisionUser(connection.repository, otherUser, new Date());
  const otherTeam = (await connection.repository.ListMembershipsByUserID(otherUser))[0].TeamID;
  await connection.repository.CreateTodoItem({ ...row("牛乳", null), TeamID: otherTeam });
  const before = await items();
  const otherBefore = await connection.repository.ListTodoItemsByTeamID(otherTeam);
  expect(await scoped().DeleteTodoItemsByNames(otherTeam, ["牛乳"])).toBe(0);
  expect(await items()).toEqual(before);
  expect(await connection.repository.ListTodoItemsByTeamID(otherTeam)).toEqual(otherBefore);
});
it.each(["session", "membership"])(
  "checks %s at SQL execution after scope creation",
  async (boundary) => {
    await scoped().CreateTodoItemsAtomic([row("牛乳"), row("牛乳")]);
    const repository = scoped();
    const before = await items();
    if (boundary === "session")
      await connection.query(sql`DELETE FROM auth_session WHERE id=${sessionId}`);
    else await connection.query(sql`DELETE FROM team_members WHERE user_id=${userId}`);
    expect(await repository.DeleteTodoItemsByNames(teamId, ["牛乳"])).toBe(0);
    expect(await items()).toEqual(before);
  },
);
it("uses a JSON name set beyond 100 targets and counts concurrent deletions only once", async () => {
  const names = Array.from({ length: 120 }, (_, index) => `商品${index}`);
  for (let index = 0; index < names.length; index += 40) {
    await scoped().CreateTodoItemsAtomic(names.slice(index, index + 40).map((name) => row(name)));
  }
  const counts = await Promise.all([
    scoped().DeleteTodoItemsByNames(teamId, names),
    scoped().DeleteTodoItemsByNames(teamId, names),
  ]);
  expect(counts.reduce((sum, value) => sum + value, 0)).toBe(120);
  expect(await items()).toEqual([]);
});
