import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase } from "../helpers/d1";
import { provisionUser } from "../../src/server/application/provision-user";
import { executeOperation } from "../../src/server/application/operations";
import {
  authorizeMcpConnection,
  executeMcpOperation,
} from "../../src/server/application/mcp-operations";
import { D1McpRepository } from "../../src/server/infrastructure/mcp-repository";
import { D1Repository } from "../../src/server/infrastructure/repository";
import {
  mcpResponseSchemas,
  requiredMcpScope,
  type McpPrincipal,
  type McpRequest,
} from "../../src/contracts/mcp";
import { responseSchemas } from "../../src/contracts/operations";

describe("MCP application authorization and ToDos", () => {
  let connection: Awaited<ReturnType<typeof createTestDatabase>>;
  let mcp: D1McpRepository;
  const now = new Date("2026-10-09T12:00:00Z");
  const context = { now, vapidPublicKey: "" };
  const list: McpRequest = { tool: "list_todos", arguments: {} };

  beforeAll(async () => {
    connection = await createTestDatabase();
    mcp = new D1McpRepository(connection.db);
  });
  afterAll(async () => {
    await connection?.close();
  });

  async function identity(scopes = ["todos:read", "todos:write"], active = true) {
    const userId = crypto.randomUUID();
    await connection.query(sql`INSERT INTO auth_user(id,name,email)
      VALUES (${userId},'MCP tester',${userId + "@example.com"})`);
    await provisionUser(connection.repository, userId, now);
    const teamId = (await connection.repository.ListMembershipsByUserID(userId))[0].TeamID;
    const principal: McpPrincipal = {
      userId,
      connectionId: crypto.randomUUID(),
      clientId: crypto.randomUUID(),
      resource: "https://mcp.example.com/mcp",
      scopes,
      expiresAt: now.getTime() / 1000 + 3600,
    };
    await mcp.createConnection({
      id: principal.connectionId,
      userId,
      clientId: principal.clientId,
      clientName: "Test client",
      resource: principal.resource,
      scopes,
      createdAt: "2026-10-08T12:00:00.000Z",
      expiresAt: "2026-10-10T12:00:00.000Z",
    });
    if (active)
      expect(
        await mcp.bindGrant(
          principal.connectionId,
          userId,
          principal.clientId,
          principal.resource,
          crypto.randomUUID(),
          now.toISOString(),
        ),
      ).toBe(true);
    return { principal, teamId };
  }
  function repository(principal: McpPrincipal, scope: string) {
    return new D1Repository(connection.db, undefined, {
      connectionId: principal.connectionId,
      userId: principal.userId,
      scope,
      now: now.toISOString(),
    });
  }
  function run(principal: McpPrincipal, request: McpRequest) {
    return executeMcpOperation(
      repository(principal, requiredMcpScope(request.tool)),
      mcp,
      request,
      principal,
      context,
    );
  }
  async function createTodo(userId: string, categoryId: string | null = null) {
    const result = await executeOperation(
      connection.repository,
      { operation: "postTodoItem", params: {}, body: { name: "Keep", categoryId } },
      { userId, ...context },
    );
    return responseSchemas.postTodoItem.parse(result.data);
  }

  it("reuses existing ToDos and categories for a non-owner without exposing team IDs", async () => {
    const { principal, teamId } = await identity(["todos:read", "todos:write", "offline_access"]);
    await connection.query(
      sql`UPDATE team_members SET role='member' WHERE user_id=${principal.userId}`,
    );
    const category = { id: crypto.randomUUID(), name: "買い物" };
    await connection.repository.CreateTodoCategory(teamId, category);
    const added = await run(principal, {
      tool: "add_todo",
      arguments: { name: " 牛乳 ", notes: "2本", categoryId: category.id },
    });
    const { item } = mcpResponseSchemas.add_todo.parse(added.data);
    expect(item).toMatchObject({ name: "牛乳", notes: "2本", categoryId: category.id });
    expect(added.data).not.toHaveProperty("item.teamId");
    expect(added.changedTeams).toEqual([teamId]);
    const listed = await run(principal, list);
    expect(listed).toEqual({
      data: { items: [item], categories: [null, category] },
      changedTeams: [],
    });
    const completed = await run(principal, {
      tool: "complete_todo",
      arguments: { itemId: item.id },
    });
    expect(completed).toEqual({
      data: { id: item.id, completed: true },
      changedTeams: [teamId],
    });
    expect((await run(principal, list)).data).toEqual({ items: [], categories: [null, category] });
    await expect(
      run(principal, { tool: "complete_todo", arguments: { itemId: item.id } }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ["missing connection", 401],
    ["other user", 401],
    ["other client", 401],
    ["other resource", 401],
    ["pending grant", 401],
    ["revoked", 401],
    ["connection expired", 401],
    ["token expired", 401],
    ["malformed principal", 401],
    ["no token scopes", 403],
    ["unknown token scope", 403],
    ["scope beyond consent", 403],
  ] as const)("rejects %s before business access", async (failure, status) => {
    const { principal } = await identity(["todos:read"], failure !== "pending grant");
    switch (failure) {
      case "missing connection":
        principal.connectionId = crypto.randomUUID();
        break;
      case "other user":
        principal.userId = crypto.randomUUID();
        break;
      case "other client":
        principal.clientId = "different-client";
        break;
      case "other resource":
        principal.resource = "https://other.example.com/mcp";
        break;
      case "revoked":
        await mcp.revokeConnection(principal.connectionId, principal.userId, now.toISOString());
        break;
      case "connection expired":
        await connection.query(sql`UPDATE mcp_connections SET expires_at=${now.toISOString()}
          WHERE id=${principal.connectionId}`);
        break;
      case "token expired":
        principal.expiresAt = now.getTime() / 1000;
        break;
      case "malformed principal":
        principal.connectionId = "not-a-uuid";
        break;
      case "no token scopes":
        principal.scopes = [];
        break;
      case "unknown token scope":
        principal.scopes = ["admin"];
        break;
      case "scope beyond consent":
        principal.scopes = ["todos:read", "todos:write"];
        break;
    }
    await expect(run(principal, list)).rejects.toMatchObject({ status });
  });

  it("requires the operation's scope even when the connection approved more capabilities", async () => {
    const { principal } = await identity();
    const item = await createTodo(principal.userId);
    const readOnly = { ...principal, scopes: ["todos:read"] };
    await expect(run(readOnly, list)).resolves.toMatchObject({ changedTeams: [] });
    await expect(
      run(readOnly, { tool: "add_todo", arguments: { name: "Forbidden" } }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      run(readOnly, { tool: "complete_todo", arguments: { itemId: item.id } }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(run({ ...principal, scopes: ["todos:write"] }, list)).rejects.toMatchObject({
      status: 403,
    });
    await expect(run({ ...principal, scopes: ["offline_access"] }, list)).rejects.toMatchObject({
      status: 403,
    });
  });

  it.each([
    { tool: "list_todos", arguments: { teamId: "other" } },
    { tool: "add_todo", arguments: { name: "Forbidden", userId: "other" } },
    { tool: "complete_todo", arguments: { itemId: "item", teamId: "other" } },
    { tool: "postTeamInvite", arguments: {} },
  ])("rejects injected identities and unsupported tools: %j", async (request) => {
    const { principal, teamId } = await identity();
    await expect(run(principal, request as McpRequest)).rejects.toMatchObject({ status: 400 });
    expect(await connection.repository.ListTodoItemsByTeamID(teamId)).toEqual([]);
  });

  it("rejects removed users and users without membership", async () => {
    const { principal } = await identity();
    await connection.query(sql`DELETE FROM team_members WHERE user_id=${principal.userId}`);
    await expect(run(principal, list)).rejects.toMatchObject({ status: 403 });
    await connection.query(sql`DELETE FROM auth_user WHERE id=${principal.userId}`);
    await expect(run(principal, list)).rejects.toMatchObject({ status: 401 });
  });

  it("isolates other teams' ToDo and category IDs and resolves membership afresh", async () => {
    const own = await identity();
    const other = await identity();
    const ownItem = await createTodo(own.principal.userId);
    const category = { id: crypto.randomUUID(), name: "Other category" };
    await connection.repository.CreateTodoCategory(other.teamId, category);
    const otherItem = await createTodo(other.principal.userId, category.id);
    const before = await connection.repository.ListTodoItemsByTeamID(other.teamId);
    await expect(
      run(own.principal, { tool: "complete_todo", arguments: { itemId: otherItem.id } }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      run(own.principal, {
        tool: "add_todo",
        arguments: { name: "Forbidden", categoryId: category.id },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await connection.repository.ListTodoItemsByTeamID(other.teamId)).toEqual(before);
    const listed = mcpResponseSchemas.list_todos.parse((await run(own.principal, list)).data);
    expect(listed.items.map((item) => item.id)).toEqual([ownItem.id]);
    expect(listed.categories).toEqual([null]);
    await connection.query(sql`UPDATE team_members SET team_id=${other.teamId},role='member'
      WHERE user_id=${own.principal.userId}`);
    const moved = mcpResponseSchemas.list_todos.parse((await run(own.principal, list)).data);
    expect(moved.items.map((item) => item.id)).toEqual([otherItem.id]);
    expect(moved.categories).toEqual([null, category]);
  });

  it.each(["revoked", "expired", "pending", "scope removed"])(
    "rechecks %s connections inside the Todo SQL after initial authorization",
    async (failure) => {
      const { principal, teamId } = await identity();
      const item = await createTodo(principal.userId);
      await authorizeMcpConnection(mcp, principal, now);
      const scoped = repository(principal, "todos:write").forMember(teamId, principal.userId);
      switch (failure) {
        case "revoked":
          await mcp.revokeConnection(principal.connectionId, principal.userId, now.toISOString());
          break;
        case "expired":
          await connection.query(sql`UPDATE mcp_connections SET expires_at=${now.toISOString()}
            WHERE id=${principal.connectionId}`);
          break;
        case "pending":
          await connection.query(sql`UPDATE mcp_connections SET grant_id=NULL
            WHERE id=${principal.connectionId}`);
          break;
        case "scope removed":
          await connection.query(sql`UPDATE mcp_connections SET scopes='["todos:read"]'
            WHERE id=${principal.connectionId}`);
          break;
      }
      expect(await scoped.DeleteTodoItem(item.id)).toBe(0);
      expect(await scoped.ListTodoItemsByTeamID(teamId)).toEqual([]);
      await expect(scoped.GetTodoItemByID(item.id)).rejects.toMatchObject({ status: 404 });
      expect(await connection.repository.GetTodoItemByID(item.id)).toMatchObject({ ID: item.id });
    },
  );

  it("cannot borrow another user's connection through forMember", async () => {
    const own = await identity();
    const other = await identity();
    await connection.query(sql`UPDATE team_members SET team_id=${own.teamId},role='member'
      WHERE user_id=${other.principal.userId}`);
    const item = await createTodo(own.principal.userId);
    const scoped = repository(own.principal, "todos:write").forMember(
      own.teamId,
      other.principal.userId,
    );
    expect(await scoped.DeleteTodoItem(item.id)).toBe(0);
    await expect(scoped.GetTodoItemByID(item.id)).rejects.toMatchObject({ status: 404 });
  });

  it.each(["add_todo", "complete_todo"] as const)(
    "rejects a revoke immediately before %s's SQL write without changing ToDos",
    async (tool) => {
      const { principal, teamId } = await identity();
      const item = await createTodo(principal.userId);
      const before = await connection.repository.ListTodoItemsByTeamID(teamId);
      const guarded = repository(principal, "todos:write");
      const scoped = guarded.forMember(teamId, principal.userId);
      const memberBoundary = vi.spyOn(guarded, "forMember").mockReturnValue(scoped);
      const revoke = () =>
        mcp.revokeConnection(principal.connectionId, principal.userId, now.toISOString());
      const create = scoped.CreateTodoItem.bind(scoped);
      const complete = scoped.DeleteTodoItem.bind(scoped);
      const createBoundary = vi
        .spyOn(scoped, "CreateTodoItem")
        .mockImplementationOnce(async (arg) => {
          await revoke();
          return create(arg);
        });
      const completeBoundary = vi
        .spyOn(scoped, "DeleteTodoItem")
        .mockImplementationOnce(async (id) => {
          await revoke();
          return complete(id);
        });
      try {
        await expect(
          executeMcpOperation(
            guarded,
            mcp,
            tool === "add_todo"
              ? { tool, arguments: { name: "Forbidden" } }
              : { tool, arguments: { itemId: item.id } },
            principal,
            context,
          ),
        ).rejects.toMatchObject({ status: 401 });
        expect(await connection.repository.ListTodoItemsByTeamID(teamId)).toEqual(before);
      } finally {
        createBoundary.mockRestore();
        completeBoundary.mockRestore();
        memberBoundary.mockRestore();
      }
    },
  );

  it.each(["revoked", "removed", "moved"])(
    "rejects %s authorization between the item and category reads",
    async (change) => {
      const own = await identity();
      const other = await identity();
      await createTodo(own.principal.userId);
      const guarded = repository(own.principal, "todos:read");
      const scoped = guarded.forMember(own.teamId, own.principal.userId);
      const memberBoundary = vi.spyOn(guarded, "forMember").mockReturnValue(scoped);
      const read = scoped.ListTodoItemsByTeamID.bind(scoped);
      const boundary = vi
        .spyOn(scoped, "ListTodoItemsByTeamID")
        .mockImplementationOnce(async (id) => {
          const items = await read(id);
          if (change === "revoked") {
            await mcp.revokeConnection(
              own.principal.connectionId,
              own.principal.userId,
              now.toISOString(),
            );
          } else if (change === "removed") {
            await connection.query(
              sql`DELETE FROM team_members WHERE user_id=${own.principal.userId}`,
            );
          } else {
            await connection.query(sql`UPDATE team_members SET team_id=${other.teamId}
            WHERE user_id=${own.principal.userId}`);
          }
          return items;
        });
      try {
        await expect(
          executeMcpOperation(guarded, mcp, list, own.principal, context),
        ).rejects.toMatchObject({ status: change === "revoked" ? 401 : 403 });
      } finally {
        boundary.mockRestore();
        memberBoundary.mockRestore();
      }
    },
  );
});
