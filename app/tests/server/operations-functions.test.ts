vi.mock("cloudflare:workers", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    void promise;
  },
}));
vi.mock("../../src/server/transport/realtime.server", () => ({ notifyTeams: mocks.notify }));
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { responseSchemas } from "../../src/contracts/operations";
import { provisionUser } from "../../src/server/application/provision-user";
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

it("rejects absent sessions before any business transaction", async () => {
  mocks.session.mockResolvedValue(null);
  expect(await mocks.handler({ data: { operation: "getMe" } })).toMatchObject({
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
  expect(await mocks.handler({ data: { operation: "getMe" } })).toMatchObject({
    ok: false,
    error: { status: 403, code: "forbidden" },
  });
  expect(mocks.session).not.toHaveBeenCalled();
});

describe("transport transaction with D1", () => {
  let connection: Awaited<ReturnType<typeof createTestDatabase>>;
  const id = crypto.randomUUID();
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
  });
  beforeEach(() => {
    mocks.session.mockResolvedValue({ user: { id } });
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
    expect(mocks.notify).toHaveBeenCalledWith(expect.anything(), [teamId]);
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
});
