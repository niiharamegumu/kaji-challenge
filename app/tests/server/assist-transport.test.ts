import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { provisionUser } from "../../src/server/application/provision-user";
import { createTestDatabase } from "../helpers/d1";
import { encodeWav, wavBase64 } from "../../src/features/assist/lib/audio";
import type { RuntimeBindings } from "../../src/server/transport/runtime.server";
const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  notify: vi.fn(),
  auth: vi.fn(),
  run: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("../../src/server/transport/runtime.server", () => ({
  createRuntime: mocks.runtime,
  notifyChanges: mocks.notify,
}));
import { handleAssistTurn } from "../../src/server/transport/assist.server";

let connection: Awaited<ReturnType<typeof createTestDatabase>>;
const userId = crypto.randomUUID(),
  sessionId = crypto.randomUUID();
let teamId: string;
const bindings = {
  APP_ORIGIN: "https://app.example.com",
  ASSIST_ENABLED: "true",
  ASSIST_GATEWAY_ID: "kaji-voice",
  MAINTENANCE_MODE: "false",
  AI: { run: mocks.run },
  ASSIST_LIMITER: { limit: mocks.limit },
} as unknown as RuntimeBindings;
beforeAll(async () => {
  connection = await createTestDatabase();
  await connection.query(
    sql`INSERT INTO auth_user(id,name,email) VALUES (${userId},'Transport',${userId + "@example.com"})`,
  );
  await provisionUser(connection.repository, userId, new Date());
  teamId = (await connection.repository.ListMembershipsByUserID(userId))[0].TeamID;
  await connection.query(
    sql`INSERT INTO auth_session(id,token,user_id,expires_at) VALUES (${sessionId},${sessionId},${userId},${new Date(Date.now() + 120000).toISOString()})`,
  );
});
beforeEach(async () => {
  await connection.query(
    sql`UPDATE assist_usage SET window_start=0,window_count=0,usage_day='',daily_count=0,total_count=0`,
  );
  vi.clearAllMocks();
  mocks.run.mockReset();
  mocks.runtime.mockReturnValue({
    auth: { api: { getSession: mocks.auth } },
    repository: connection.repository,
    db: connection.db,
  });
  mocks.auth.mockResolvedValue({ user: { id: userId }, session: { id: sessionId } });
  mocks.limit.mockResolvedValue({ success: true });
});
afterAll(async () => {
  await connection?.close();
});
function request(
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new Request("https://app.example.com/api/assist/turn", {
    method: options.method ?? "POST",
    headers: {
      origin: bindings.APP_ORIGIN,
      "content-type": "application/json",
      ...options.headers,
    },
    ...(options.method === "GET"
      ? {}
      : {
          body:
            options.body ??
            JSON.stringify({
              expectedTeamId: teamId,
              audioBase64: wavBase64(encodeWav([new Float32Array(16000).fill(0.2)], 16000)),
            }),
        }),
  });
}
it.each([
  [{ method: "GET" }, 405],
  [{ headers: { origin: "https://evil.example" } }, 403],
  [{ headers: { origin: "" } }, 403],
  [{ headers: { "sec-fetch-site": "cross-site" } }, 403],
  [{ headers: { "content-type": "text/plain" } }, 415],
  [{ body: "{" }, 400],
  [{ body: "x".repeat(1048577), headers: { "content-length": "1" } }, 413],
] as const)("rejects invalid HTTP before AI (case %#)", async (options, status) => {
  expect((await handleAssistTurn(request(options), bindings)).status).toBe(status);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("stays off by default and does not authenticate or invoke AI while disabled", async () => {
  expect((await handleAssistTurn(request(), { ...bindings, ASSIST_ENABLED: "false" })).status).toBe(
    503,
  );
  expect(mocks.runtime).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
it("rejects absent sessions and rate limits before inference", async () => {
  mocks.auth.mockResolvedValueOnce(null);
  expect((await handleAssistTurn(request(), bindings)).status).toBe(401);
  mocks.limit.mockResolvedValueOnce({ success: false });
  const response = await handleAssistTurn(request(), bindings);
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
  expect(mocks.run).not.toHaveBeenCalled();
});
it("executes both fixture inferences through the gateway, saves to D1, notifies, and logs no content", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  mocks.run.mockResolvedValueOnce({ text: "秘密の牛乳を追加して" }).mockResolvedValueOnce({
    response: JSON.stringify({
      intent: "add_todo",
      items: [{ name: "秘密の牛乳", categoryName: null }],
    }),
  });
  const response = await handleAssistTurn(request(), bindings);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    kind: "added",
    items: [{ name: "秘密の牛乳", teamId }],
  });
  expect(mocks.run).toHaveBeenCalledTimes(2);
  for (const call of mocks.run.mock.calls)
    expect(call[2]).toMatchObject({
      gateway: {
        id: "kaji-voice",
        skipCache: true,
        collectLog: false,
        retries: { maxAttempts: 1 },
      },
    });
  expect(mocks.notify).toHaveBeenCalledWith(bindings, [teamId], ["todos"]);
  expect(JSON.stringify(log.mock.calls)).not.toContain("秘密");
  log.mockRestore();
});
it("rejects truncated or malformed completions without a write", async () => {
  const count = (await connection.repository.ListTodoItemsByTeamID(teamId)).length;
  mocks.run.mockResolvedValueOnce({ text: "卵を追加して" }).mockResolvedValueOnce({
    response: '{"intent":"add_todo","items":[',
  });
  expect((await handleAssistTurn(request(), bindings)).status).toBe(502);
  expect(await connection.repository.ListTodoItemsByTeamID(teamId)).toHaveLength(count);
});

it("stops exhausted or missing persistent quota before invoking AI", async () => {
  await connection.query(sql`UPDATE assist_usage SET total_count=500`);
  expect((await handleAssistTurn(request(), bindings)).status).toBe(429);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("never refunds an inference failure and never automatically retries it", async () => {
  mocks.run.mockRejectedValueOnce(new Error("Provider unavailable"));
  expect((await handleAssistTurn(request(), bindings)).status).toBe(503);
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect((await connection.query(sql`SELECT total_count FROM assist_usage`)).rows[0]).toEqual({
    total_count: 1,
  });
});
it("fails closed if quota storage is unavailable", async () => {
  mocks.runtime.mockReturnValueOnce({
    auth: { api: { getSession: mocks.auth } },
    repository: connection.repository,
    db: {
      get: async () => {
        throw new Error("quota database unavailable");
      },
    },
  });
  expect((await handleAssistTurn(request(), bindings)).status).toBe(503);
  expect(mocks.run).not.toHaveBeenCalled();
});
