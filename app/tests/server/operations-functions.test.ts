vi.mock("cloudflare:workers", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    void promise;
  },
}));
vi.mock("../../src/server/transport/realtime.server", () => ({ notifyTeams: mocks.notify }));
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { operationSchema, responseSchemas } from "../../src/contracts/operations";
import { provisionUser } from "../../src/server/application/provision-user";
import { executeOperation } from "../../src/server/application/operations";
import { createTestDatabase } from "../helpers/d1";
import type { WireResult } from "../../src/server/transport/operations.functions";

// Capture only the framework registration; execute the real transport/application below.
const mocks = vi.hoisted(() => ({
  handler: undefined as unknown as (args: { data: unknown }) => Promise<WireResult>,
  headers: new Headers(),
  runtime: vi.fn(),
  session: vi.fn(),
  repository: {} as object,
  notify: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: (validate: (raw: unknown) => unknown) => ({
      handler: (handler: typeof mocks.handler) => {
        mocks.handler = ({ data }) => handler({ data: validate(data) });
      },
    }),
  }),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders: () => mocks.headers }));
vi.mock("../../src/server/transport/runtime.server", () => ({
  withRuntime: mocks.runtime,
  notifyChanges: mocks.notify,
}));
import "../../src/server/transport/operations.functions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.headers = new Headers({ origin: "https://app.example.com" });
  mocks.runtime.mockImplementation(async (fn) =>
    fn({
      bindings: { APP_ORIGIN: "https://app.example.com", VAPID_PUBLIC_KEY: "test" },
      auth: { api: { getSession: mocks.session } },
      repository: mocks.repository,
    }),
  );
});

it("rejects malformed inputs before opening the runtime", async () => {
  expect(
    await mocks.handler({ data: { operation: "postTask", body: { title: 42 } } }),
  ).toMatchObject({ ok: false, error: { status: 400, code: "invalid_request" } });
  expect(mocks.runtime).not.toHaveBeenCalled();
});

it.each([
  { operation: "getMe" },
  { operation: "postTodoCategoriesReorder", body: { categoryIds: [null] } },
  {
    operation: "patchTodoCategory",
    params: { categoryId: crypto.randomUUID() },
    body: { name: "Name" },
  },
])("rejects absent sessions before any business transaction: %j", async (data) => {
  mocks.session.mockResolvedValue(null);
  expect(await mocks.handler({ data })).toMatchObject({
    ok: false,
    error: { status: 401, code: "unauthorized" },
  });
  expect(mocks.session).toHaveBeenCalledWith({ headers: mocks.headers });
});

it.each<Record<string, string>>([
  { origin: "https://other.example.com" },
  { origin: "https://app.example.com", "sec-fetch-site": "cross-site" },
])("rejects cross-origin requests before authentication: %j", async (headers) => {
  mocks.headers = new Headers(headers);
  expect(
    await mocks.handler({
      data: { operation: "postTodoCategoriesReorder", body: { categoryIds: [null] } },
    }),
  ).toMatchObject({
    ok: false,
    error: { status: 403, code: "forbidden" },
  });
  expect(mocks.session).not.toHaveBeenCalled();
});

describe("transport transaction with D1", () => {
  let connection: Awaited<ReturnType<typeof createTestDatabase>>;
  const id = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const foreign: Record<string, string> = {};
  let teamId: string;
  beforeAll(async () => {
    connection = await createTestDatabase();
    await connection.query(sql`INSERT INTO auth_user (id,name,email)
      VALUES (${id},'Transport',${id + "@example.com"})`);
    await connection.query(sql`INSERT INTO auth_account (id,user_id,provider_id,account_id)
      VALUES (${crypto.randomUUID()},${id},'google',${id})`);
    await provisionUser(connection.repository, id, new Date());
    const [member] = await connection.repository.ListMembershipsByUserID(id);
    teamId = member.TeamID;
    await connection.query(
      sql`INSERT INTO auth_user(id,name,email) VALUES (${otherId},'Other',${otherId + "@example.com"})`,
    );
    await provisionUser(connection.repository, otherId, new Date());
    foreign.team = (await connection.repository.ListMembershipsByUserID(otherId))[0].TeamID;
    for (const [key, operation, body] of [
      ["task", "postTask", { title: "Other task", type: "daily", penaltyPoints: 1 }],
      ["todo", "postTodoItem", { name: "Other todo" }],
      ["category", "postTodoCategory", { name: "Other category" }],
      [
        "reminder",
        "postReminder",
        { title: "Other reminder", kind: "one_time", startDate: "2099-01-01" },
      ],
      ["penalty", "postPenaltyRule", { name: "Other penalty", threshold: 10 }],
      [
        "push",
        "postPushSubscription",
        {
          endpoint: "https://fcm.googleapis.com/other",
          keys: { p256dh: "fixture-key", auth: "fixture-auth" },
          platform: "ios_safari_pwa",
        },
      ],
    ] as const) {
      const result = await executeOperation(
        connection.repository,
        operationSchema.parse({ operation, body }),
        { userId: otherId, now: new Date(), vapidPublicKey: "" },
      );
      foreign[key] =
        key === "category"
          ? (await connection.repository.ListTodoCategories(foreign.team)).find(
              (category) => category !== null,
            )!.id
          : (result.data as { id: string }).id;
    }
  });
  beforeEach(async () => {
    await connection.query(sql`INSERT INTO auth_session(id,token,user_id,expires_at)
      VALUES (${sessionId},${sessionId},${id},${new Date(Date.now() + 60_000).toISOString()})
      ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at`);
    mocks.session.mockResolvedValue({ user: { id }, session: { id: sessionId } });
    mocks.repository = connection.repository;
  });
  afterAll(async () => {
    if (!connection) return;
    for (const member of await connection.repository.ListMembershipsByUserID(id))
      await connection.query(sql`DELETE FROM teams WHERE id=${member.TeamID}`);
    await connection.query(sql`DELETE FROM auth_user WHERE id=${id}`);
    await connection.close();
  });

  const request = () =>
    mocks.handler({
      data: {
        operation: "postTask",
        body: { title: "Transport task", type: "daily", penaltyPoints: 1 },
      },
    });

  it("returns only a validated DTO and notifies after commit", async () => {
    const result = await request();
    expect(result).toMatchObject({ ok: true, data: { title: "Transport task" } });
    expect(result).not.toHaveProperty("state");
    expect(await connection.repository.ListTasksByTeamID(teamId)).toHaveLength(1);
    expect(mocks.notify).toHaveBeenCalledWith(expect.anything(), [teamId], ["tasks"]);
  });
  it("returns a safe error on malformed output without claiming that committed data was rolled back", async () => {
    const parse = vi.spyOn(responseSchemas.postTask, "parse").mockImplementationOnce(() => {
      throw new Error("invalid");
    });
    try {
      expect(await request()).toMatchObject({ ok: false, error: { status: 500 } });
    } finally {
      parse.mockRestore();
    }
    expect(await connection.repository.ListTasksByTeamID(teamId)).toHaveLength(2);
  });

  it.each([
    { operation: "patchTask", params: () => ({ taskId: foreign.task }), body: { title: "Denied" } },
    { operation: "deleteTask", params: () => ({ taskId: foreign.task }) },
    {
      operation: "postTaskCompletion",
      params: () => ({ taskId: foreign.task }),
      body: { targetDate: "2026-10-10", action: "complete" },
    },
    { operation: "postTasksReorder", body: () => ({ taskIds: [foreign.task] }) },
    {
      operation: "patchTodoItem",
      params: () => ({ itemId: foreign.todo }),
      body: { name: "Denied" },
    },
    { operation: "deleteTodoItem", params: () => ({ itemId: foreign.todo }) },
    { operation: "postTodoItemsReorder", body: () => ({ itemIds: [foreign.todo] }) },
    {
      operation: "patchTodoCategory",
      params: () => ({ categoryId: foreign.category }),
      body: { name: "Denied" },
    },
    { operation: "deleteTodoCategory", params: () => ({ categoryId: foreign.category }) },
    {
      operation: "postTodoCategoriesReorder",
      body: () => ({ categoryIds: [null, foreign.category] }),
    },
    {
      operation: "patchReminder",
      params: () => ({ reminderId: foreign.reminder }),
      body: { title: "Denied" },
    },
    { operation: "deleteReminder", params: () => ({ reminderId: foreign.reminder }) },
    {
      operation: "patchPenaltyRule",
      params: () => ({ ruleId: foreign.penalty }),
      body: { name: "Denied" },
    },
    { operation: "deletePenaltyRule", params: () => ({ ruleId: foreign.penalty }) },
    { operation: "deletePushSubscription", params: () => ({ subscriptionId: foreign.push }) },
  ])("rejects foreign IDs at the normal $operation entry", async (test) => {
    const state = () =>
      Promise.all([
        connection.repository.ListTasksByTeamID(foreign.team),
        connection.repository.ListTodoItemsByTeamID(foreign.team),
        connection.repository.ListTodoCategories(foreign.team),
        connection.repository.ListRemindersByTeamID(foreign.team),
        connection.repository.ListPenaltyRulesByTeamID(foreign.team),
        connection.repository.ListPushSubscriptionsByUserID(otherId),
        connection.repository.HasTaskCompletionDaily({
          TaskID: foreign.task,
          TargetDate: "2026-10-10",
        }),
      ]);
    const before = await state();
    const result = await mocks.handler({
      data: {
        operation: test.operation,
        params: test.params?.(),
        body: typeof test.body === "function" ? test.body() : test.body,
        userId: otherId,
        teamId: foreign.team,
      },
    });
    expect(result).toMatchObject({ ok: false, error: { status: expect.any(Number) } });
    if (!result.ok) expect([400, 403, 404, 409]).toContain(result.error.status);
    expect(await state()).toEqual(before);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it.each([
    { operation: "postTask", body: { title: "Own new task", type: "daily", penaltyPoints: 1 } },
    { operation: "postTodoItem", body: { name: "Own new item" } },
    { operation: "postTodoCategory", body: { name: "Own new category" } },
    {
      operation: "postReminder",
      body: { title: "Own new reminder", kind: "one_time", startDate: "2099-01-01" },
    },
    { operation: "postPenaltyRule", body: { name: "Own new penalty", threshold: 20 } },
    {
      operation: "postPushSubscription",
      body: {
        endpoint: "https://fcm.googleapis.com/own",
        keys: { p256dh: "fixture-key", auth: "fixture-auth" },
        platform: "ios_safari_pwa",
      },
    },
  ])("ignores forged identities in headers, params and $operation bodies", async (test) => {
    mocks.headers.set("x-user-id", otherId);
    mocks.headers.set("x-team-id", foreign.team);
    const created = await mocks.handler({
      data: {
        operation: test.operation,
        userId: otherId,
        teamId: foreign.team,
        params: { userId: otherId, teamId: foreign.team },
        body: {
          ...test.body,
          userId: otherId,
          teamId: foreign.team,
        },
      },
    });
    if (test.operation === "postTodoCategory") {
      expect(created).toMatchObject({
        ok: true,
        data: {
          categories: expect.arrayContaining([
            expect.objectContaining({ name: "Own new category" }),
          ]),
        },
      });
      expect(await connection.repository.ListTodoCategories(foreign.team)).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "Own new category" })]),
      );
    } else expect(created).toMatchObject({ ok: true, data: { teamId } });
    const listed = await mocks.handler({
      data: { operation: "listTasks", params: { teamId: foreign.team } },
    });
    expect(listed).toMatchObject({ ok: true });
    expect(JSON.stringify(listed)).not.toContain(foreign.task);
    expect(await connection.repository.ListTasksByTeamID(foreign.team)).toHaveLength(1);
  });

  it.each(["revoked", "expired", "wrong session owner"])(
    "rejects a %s session after entry authentication without reading or writing team data",
    async (change) => {
      const before = await connection.repository.ListTasksByTeamID(teamId);
      if (change === "revoked")
        await connection.query(sql`DELETE FROM auth_session WHERE id=${sessionId}`);
      else if (change === "expired")
        await connection.query(sql`UPDATE auth_session SET expires_at='2000-01-01T00:00:00.000Z'
          WHERE id=${sessionId}`);
      else
        mocks.session.mockResolvedValue({
          user: { id: crypto.randomUUID() },
          session: { id: sessionId },
        });
      for (const data of [
        { operation: "listTasks" },
        {
          operation: "postTask",
          body: { title: "Denied", type: "daily", penaltyPoints: 1 },
        },
      ]) {
        expect(await mocks.handler({ data })).toMatchObject({ ok: false, error: { status: 401 } });
      }
      expect(await connection.repository.ListTasksByTeamID(teamId)).toEqual(before);
      expect(mocks.notify).not.toHaveBeenCalled();
    },
  );
});
