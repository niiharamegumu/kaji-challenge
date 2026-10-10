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
  const now = new Date();
  const context = { now, vapidPublicKey: "" };
  const list: McpRequest = { tool: "list_todos", arguments: {} };

  beforeAll(async () => {
    connection = await createTestDatabase();
    mcp = new D1McpRepository(connection.db);
  });
  afterAll(async () => {
    await connection?.close();
  });

  async function identity(
    scopes = ["todos:read", "todos:write"],
    active = true,
    expiry: { token?: number; connection?: string } = {},
  ) {
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
      expiresAt: expiry.token ?? Date.now() / 1000 + 3600,
    };
    await mcp.createConnection({
      id: principal.connectionId,
      userId,
      clientId: principal.clientId,
      clientName: "Test client",
      resource: principal.resource,
      scopes,
      createdAt: new Date(now.getTime() - 86_400_000).toISOString(),
      expiresAt: expiry.connection ?? new Date(Date.now() + 86_400_000).toISOString(),
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
      tokenExpiresAt: new Date(principal.expiresAt * 1000).toISOString(),
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

  it.each(["token", "connection"] as const)(
    "rejects natural %s expiry while fetching the connection",
    async (kind) => {
      const deadline = Date.now() + 60_000;
      const { principal } = await identity(undefined, true, {
        [kind]: kind === "token" ? deadline / 1000 : new Date(deadline).toISOString(),
      });
      const read = mcp.getConnection.bind(mcp);
      const boundary = vi.spyOn(mcp, "getConnection").mockImplementationOnce(async (id) => {
        const value = await read(id);
        vi.setSystemTime(deadline);
        return value;
      });
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        await expect(authorizeMcpConnection(mcp, principal)).rejects.toMatchObject({
          status: 401,
        });
      } finally {
        boundary.mockRestore();
        vi.useRealTimers();
      }
    },
  );

  it.each(["token", "connection"] as const)(
    "rechecks natural %s expiry before returning a list",
    async (kind) => {
      const deadline = Date.now() + 60_000;
      const { principal, teamId } = await identity(undefined, true, {
        [kind]: kind === "token" ? deadline / 1000 : new Date(deadline).toISOString(),
      });
      await createTodo(principal.userId);
      const guarded = repository(principal, "todos:read");
      const scoped = guarded.forMember(teamId, principal.userId);
      const memberBoundary = vi.spyOn(guarded, "forMember").mockReturnValue(scoped);
      const read = scoped.ListTodoCategories.bind(scoped);
      const boundary = vi.spyOn(scoped, "ListTodoCategories").mockImplementationOnce(async (id) => {
        const value = await read(id);
        // Only the application clock advances; the D1 clock is tested separately below.
        vi.setSystemTime(deadline);
        return value;
      });
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        await expect(
          executeMcpOperation(guarded, mcp, list, principal, context),
        ).rejects.toMatchObject({
          status: 401,
        });
      } finally {
        boundary.mockRestore();
        memberBoundary.mockRestore();
        vi.useRealTimers();
      }
    },
  );

  it.each(["token", "connection"] as const)(
    "rejects natural %s expiry before a write response without retrying the committed write",
    async (kind) => {
      const deadline = Date.now() + 60_000;
      const { principal, teamId } = await identity(undefined, true, {
        [kind]: kind === "token" ? deadline / 1000 : new Date(deadline).toISOString(),
      });
      const guarded = repository(principal, "todos:write");
      const scoped = guarded.forMember(teamId, principal.userId);
      const memberBoundary = vi.spyOn(guarded, "forMember").mockReturnValue(scoped);
      const create = scoped.CreateTodoItem.bind(scoped);
      const boundary = vi.spyOn(scoped, "CreateTodoItem").mockImplementationOnce(async (item) => {
        const created = await create(item);
        vi.setSystemTime(deadline);
        return created;
      });
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        await expect(
          executeMcpOperation(
            guarded,
            mcp,
            {
              tool: "add_todo",
              arguments: { name: "Already saved" },
            },
            principal,
            context,
          ),
        ).rejects.toMatchObject({ status: 401 });
        expect(boundary).toHaveBeenCalledTimes(1);
        expect(await connection.repository.ListTodoItemsByTeamID(teamId)).toEqual([
          expect.objectContaining({ Name: "Already saved" }),
        ]);
      } finally {
        boundary.mockRestore();
        memberBoundary.mockRestore();
        vi.useRealTimers();
      }
    },
  );

  it.each(["token", "connection"] as const)(
    "blocks a prepared batch and subsequent reads/deletes after natural %s expiry in D1",
    async (kind) => {
      const sampledAt = Date.now();
      const clock = await connection.db.get<{ now: string }>(
        sql`SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now`,
      );
      expect(Date.parse(clock!.now)).toBeGreaterThanOrEqual(sampledAt);
      expect(Date.parse(clock!.now)).toBeLessThanOrEqual(Date.now());
      const deadline = new Date(Date.parse(clock!.now) + 1500).toISOString();
      const { principal, teamId } = await identity(undefined, true, {
        [kind]: kind === "token" ? Date.parse(deadline) / 1000 : deadline,
      });
      const item = await createTodo(principal.userId);
      const before = await connection.repository.ListTodoItemsByTeamID(teamId);
      const connectionBefore = await mcp.getConnection(principal.connectionId);
      await authorizeMcpConnection(mcp, principal);
      const scoped = repository(principal, "todos:write").forMember(teamId, principal.userId);
      await scoped.assertAccess();
      const batch = connection.db.batch.bind(connection.db);
      const boundary = vi.spyOn(connection.db, "batch").mockImplementationOnce(async (queries) => {
        const start = await connection.db.get<{ now: string }>(
          sql`SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now`,
        );
        expect(start!.now < deadline).toBe(true);
        // Hold already-built SQL until the real database clock crosses the unchanged deadline.
        await vi.waitFor(
          async () => {
            const row = await connection.db.get<{ now: string }>(
              sql`SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now`,
            );
            expect(row!.now >= deadline).toBe(true);
          },
          { timeout: 5000, interval: 25 },
        );
        return batch(queries);
      });
      try {
        expect(
          await scoped.CreateTodoItem({
            ID: crypto.randomUUID(),
            TeamID: teamId,
            Name: "Must not persist",
            Notes: null,
            CategoryID: null,
            SortKey: 100,
            CreatedAt: now.toISOString(),
            UpdatedAt: now.toISOString(),
          }),
        ).toBe(false);
        expect(await scoped.DeleteTodoItem(item.id)).toBe(0);
        expect(await scoped.ListTodoItemsByTeamID(teamId)).toEqual([]);
        await expect(scoped.assertAccess()).rejects.toMatchObject({ status: 401 });
        expect(await connection.repository.ListTodoItemsByTeamID(teamId)).toEqual(before);
        expect(await mcp.getConnection(principal.connectionId)).toEqual(connectionBefore);
      } finally {
        boundary.mockRestore();
      }
    },
  );

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

  it("does not reveal whether a forbidden ToDo ID exists", async () => {
    const own = await identity();
    const other = await identity();
    const hidden = await createTodo(other.principal.userId);
    const before = await connection.repository.ListTodoItemsByTeamID(other.teamId);
    const errors = [];
    for (const itemId of [hidden.id, crypto.randomUUID()]) {
      const result = await Promise.allSettled([
        run(own.principal, { tool: "complete_todo", arguments: { itemId } }),
      ]);
      expect(result[0].status).toBe("rejected");
      if (result[0].status === "rejected") {
        const { status, code, message } = result[0].reason;
        errors.push({ status, code, message });
      }
    }
    expect(errors).toHaveLength(2);
    expect(errors[0]).toEqual(errors[1]);
    expect(errors[0]).toMatchObject({ status: 404 });
    expect(JSON.stringify(errors)).not.toContain(hidden.id);
    expect(await connection.repository.ListTodoItemsByTeamID(other.teamId)).toEqual(before);
  });

  it.each(["revoked", "expired", "pending", "scope removed"])(
    "rechecks %s connections inside the Todo SQL after initial authorization",
    async (failure) => {
      const { principal, teamId } = await identity();
      const item = await createTodo(principal.userId);
      await authorizeMcpConnection(mcp, principal);
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

  it.each(
    (["add_todo", "complete_todo"] as const).flatMap((tool) =>
      (["revoked", "expired", "scope removed", "moved"] as const).map((change) => ({
        tool,
        change,
      })),
    ),
  )(
    "rejects $change immediately before $tool's SQL write without changing ToDos",
    async ({ tool, change }) => {
      const { principal, teamId } = await identity();
      const other = await identity();
      const item = await createTodo(principal.userId);
      const before = await connection.repository.ListTodoItemsByTeamID(teamId);
      const otherBefore = await connection.repository.ListTodoItemsByTeamID(other.teamId);
      const guarded = repository(principal, "todos:write");
      const scoped = guarded.forMember(teamId, principal.userId);
      const memberBoundary = vi.spyOn(guarded, "forMember").mockReturnValue(scoped);
      const invalidate = async () => {
        if (change === "revoked") {
          await mcp.revokeConnection(principal.connectionId, principal.userId, now.toISOString());
        } else if (change === "expired") {
          await connection.query(sql`UPDATE mcp_connections SET expires_at=${now.toISOString()}
            WHERE id=${principal.connectionId}`);
        } else if (change === "scope removed") {
          await connection.query(sql`UPDATE mcp_connections SET scopes='["todos:read"]'
            WHERE id=${principal.connectionId}`);
        } else {
          await connection.query(sql`UPDATE team_members SET team_id=${other.teamId},role='member'
            WHERE user_id=${principal.userId}`);
        }
      };
      const create = scoped.CreateTodoItem.bind(scoped);
      const complete = scoped.DeleteTodoItem.bind(scoped);
      const createBoundary = vi
        .spyOn(scoped, "CreateTodoItem")
        .mockImplementationOnce(async (arg) => {
          await invalidate();
          return create(arg);
        });
      const completeBoundary = vi
        .spyOn(scoped, "DeleteTodoItem")
        .mockImplementationOnce(async (id) => {
          await invalidate();
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
        ).rejects.toMatchObject({
          status: change === "scope removed" || change === "moved" ? 403 : 401,
        });
        expect(await connection.repository.ListTodoItemsByTeamID(teamId)).toEqual(before);
        expect(await connection.repository.ListTodoItemsByTeamID(other.teamId)).toEqual(
          otherBefore,
        );
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
