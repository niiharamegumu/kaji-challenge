import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase } from "../helpers/d1";
import { provisionUser } from "../../src/server/application/provision-user";
import { executeOperation } from "../../src/server/application/operations";
import { operationSchema, responseSchemas } from "../../src/contracts/operations";
import type { TodoItem } from "../../src/contracts/models";

describe("ToDo repository membership boundary", () => {
  let connection: Awaited<ReturnType<typeof createTestDatabase>>;
  const owner = crypto.randomUUID();
  const member = crypto.randomUUID();
  const outsider = crypto.randomUUID();
  const now = new Date("2026-10-09T00:00:00Z");
  let teamId: string;
  let otherTeamId: string;

  async function run(operation: string, body?: unknown, params = {}, userId = member) {
    const input = operationSchema.parse({ operation, body, params });
    const result = await executeOperation(connection.repository, input, {
      userId,
      now,
      vapidPublicKey: "",
    });
    return responseSchemas[input.operation].parse(result.data);
  }
  const create = async (userId = owner) =>
    (await run("postTodoItem", { name: "Keep this ToDo" }, {}, userId)) as TodoItem;
  const createParams = (id: string, targetTeamId: string) => ({
    ID: id,
    TeamID: targetTeamId,
    Name: "Unexpected insert",
    Notes: null,
    CategoryID: null,
    SortKey: 100,
    CreatedAt: now.toISOString(),
    UpdatedAt: now.toISOString(),
  });
  const restoreMembership = () =>
    connection.query(sql`INSERT INTO team_members(team_id,user_id,role,created_at)
      VALUES (${teamId},${member},'member',${now.toISOString()})
      ON CONFLICT(user_id) DO UPDATE SET team_id=excluded.team_id,role=excluded.role`);

  beforeAll(async () => {
    connection = await createTestDatabase();
    for (const id of [owner, member, outsider]) {
      await connection.query(sql`INSERT INTO auth_user(id,name,email)
        VALUES (${id},'ToDo access',${id + "@example.com"})`);
    }
    for (const id of [owner, outsider]) await provisionUser(connection.repository, id, now);
    teamId = (await connection.repository.ListMembershipsByUserID(owner))[0].TeamID;
    otherTeamId = (await connection.repository.ListMembershipsByUserID(outsider))[0].TeamID;
    await restoreMembership();
  });
  afterAll(async () => {
    await connection?.close();
  });

  it("allows a current non-owner member to read, add, update and complete its team's ToDos", async () => {
    const item = await create(member);
    const scoped = connection.repository.forMember(teamId, member);
    expect(await scoped.GetTodoItemByID(item.id)).toMatchObject({ TeamID: teamId });
    expect((await scoped.ListTodoItemsByTeamID(teamId)).map((row) => row.ID)).toContain(item.id);
    expect(await run("patchTodoItem", { name: "Updated" }, { itemId: item.id })).toMatchObject({
      name: "Updated",
    });
    expect(await run("deleteTodoItem", undefined, { itemId: item.id })).toEqual({});
    await expect(connection.repository.GetTodoItemByID(item.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it.each(["get", "list", "delete", "create", "update"] as const)(
    "rejects a foreign team's ToDo at the scoped repository %s boundary",
    async (operation) => {
      const item = await create(outsider);
      const before = await connection.repository.ListTodoItemsByTeamID(otherTeamId);
      const scoped = connection.repository.forMember(teamId, member);
      switch (operation) {
        case "get":
          await expect(scoped.GetTodoItemByID(item.id)).rejects.toMatchObject({ status: 404 });
          break;
        case "list":
          expect(await scoped.ListTodoItemsByTeamID(otherTeamId)).toEqual([]);
          break;
        case "delete":
          expect(await scoped.DeleteTodoItem(item.id)).toBe(0);
          break;
        case "create":
          expect(await scoped.CreateTodoItem(createParams(crypto.randomUUID(), otherTeamId))).toBe(
            false,
          );
          break;
        case "update":
          expect(
            await scoped.UpdateTodoItem({
              ID: item.id,
              TeamID: otherTeamId,
              Name: "Unexpected edit",
              UpdatedAt: now.toISOString(),
            }),
          ).toBe(false);
          break;
      }
      expect(await connection.repository.ListTodoItemsByTeamID(otherTeamId)).toEqual(before);
    },
  );

  it.each(["removed", "moved"])(
    "rechecks membership in SQL after a scoped member is %s",
    async (change) => {
      const item = await create();
      const before = await connection.repository.ListTodoItemsByTeamID(teamId);
      const scoped = connection.repository.forMember(teamId, member);
      if (change === "removed") {
        await connection.query(sql`DELETE FROM team_members WHERE user_id=${member}`);
      } else {
        await connection.query(
          sql`UPDATE team_members SET team_id=${otherTeamId} WHERE user_id=${member}`,
        );
      }
      try {
        await expect(scoped.GetTodoItemByID(item.id)).rejects.toMatchObject({ status: 404 });
        expect(await scoped.ListTodoItemsByTeamID(teamId)).toEqual([]);
        expect(await scoped.DeleteTodoItem(item.id)).toBe(0);
        expect(await scoped.CreateTodoItem(createParams(crypto.randomUUID(), teamId))).toBe(false);
        expect(
          await scoped.UpdateTodoItem({
            ID: item.id,
            TeamID: teamId,
            Name: "Unexpected edit",
            UpdatedAt: now.toISOString(),
          }),
        ).toBe(false);
        expect(await connection.repository.ListTodoItemsByTeamID(teamId)).toEqual(before);
      } finally {
        await restoreMembership();
      }
    },
  );

  it("does not return another team's categories through a scoped repository", async () => {
    const category = { id: crypto.randomUUID(), name: "Private foreign category" };
    await connection.repository.CreateTodoCategory(otherTeamId, category);
    const scoped = connection.repository.forMember(teamId, member);
    await expect(scoped.ListTodoCategories(otherTeamId)).rejects.toMatchObject({ status: 404 });
    expect(await connection.repository.ListTodoCategories(otherTeamId)).toContainEqual(category);
  });

  it.each(["membership removed", "item deleted"])(
    "rejects completion if %s between the application read and DELETE",
    async (change) => {
      const item = await create();
      const scoped = connection.repository.forMember(teamId, member);
      const remove = scoped.DeleteTodoItem.bind(scoped);
      // Only schedule the competing change; both DELETE statements still execute on real D1.
      const boundary = vi.spyOn(connection.repository, "forMember").mockReturnValueOnce(scoped);
      const deletion = vi.spyOn(scoped, "DeleteTodoItem").mockImplementationOnce(async (id) => {
        if (change === "membership removed") {
          await connection.query(sql`DELETE FROM team_members WHERE user_id=${member}`);
        } else {
          await connection.repository.DeleteTodoItem(id);
        }
        return remove(id);
      });
      try {
        await expect(run("deleteTodoItem", undefined, { itemId: item.id })).rejects.toMatchObject({
          status: 404,
        });
        expect(deletion).toHaveBeenCalledOnce();
        const rows = await connection.repository.ListTodoItemsByTeamID(teamId);
        expect(rows.some((row) => row.ID === item.id)).toBe(change === "membership removed");
      } finally {
        deletion.mockRestore();
        boundary.mockRestore();
        await restoreMembership();
      }
    },
  );

  it("preserves unscoped repository access for fixtures and jobs", async () => {
    const item = await create(outsider);
    expect(await connection.repository.GetTodoItemByID(item.id)).toMatchObject({
      TeamID: otherTeamId,
    });
    expect(await connection.repository.DeleteTodoItem(item.id)).toBe(1);
    expect(await connection.repository.DeleteTodoItem(item.id)).toBe(0);
  });
});
