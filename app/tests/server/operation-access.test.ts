import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { responseSchemas } from "../../src/contracts/operations";
import { executeOperation } from "../../src/server/application/operations";
import { createAuth } from "../../src/server/infrastructure/auth";
import { createDatabase } from "../../src/server/infrastructure/database";
import { createTestDatabase } from "../helpers/d1";

const own = { user: crypto.randomUUID(), team: crypto.randomUUID() };
const other = { user: crypto.randomUUID(), team: crypto.randomUUID() };
const sessionId = crypto.randomUUID();
const context = { userId: own.user, now: new Date(), vapidPublicKey: "" };
let c: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  c = await createTestDatabase();
  for (const identity of [own, other]) {
    await c.query(sql`INSERT INTO auth_user(id,name,email)
      VALUES (${identity.user},'Current user',${identity.user + "@example.com"})`);
    await c.repository.ProvisionUser(
      identity.user,
      identity.team,
      "Current team",
      context.now.toISOString(),
    );
  }
});
beforeEach(async () => {
  await c.query(sql`INSERT INTO team_members(team_id,user_id,role,created_at)
    VALUES (${own.team},${own.user},'owner',${context.now.toISOString()})
    ON CONFLICT(user_id) DO UPDATE SET team_id=excluded.team_id,role=excluded.role`);
  await c.query(sql`INSERT INTO auth_session(id,token,user_id,expires_at)
    VALUES (${sessionId},${sessionId},${own.user},${new Date(Date.now() + 3600_000).toISOString()})
    ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at`);
});
afterAll(async () => {
  await c?.close();
});

it("authenticates and returns getMe using four D1 statements without caching authentication", async () => {
  let queryCount = 0;
  // Count real statements without storing SQL or values; every call still reaches D1.
  const counted = createDatabase(
    new Proxy(c.binding, {
      get(target, key) {
        if (key === "prepare")
          return (query: string) => {
            queryCount++;
            return target.prepare(query);
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  );
  const secret = "operation-fixture-secret-at-least-32-characters";
  const auth = createAuth(counted.db, {
    baseURL: "https://app.example.com",
    secret,
    googleClientId: "test",
    googleClientSecret: "test",
    allowedEmails: [own.user + "@example.com"],
  });
  const signature = createHmac("sha256", secret).update(sessionId).digest("base64");
  const headers = new Headers({
    cookie: `__Secure-better-auth.session_token=${encodeURIComponent(sessionId + "." + signature)}`,
  });
  const session = await auth.api.getSession({ headers });
  expect(queryCount).toBe(1);
  expect(session?.user.id).toBe(own.user);
  expect(session?.session.expiresAt).toBeInstanceOf(Date);
  expect(session?.user.createdAt).toBeInstanceOf(Date);
  if (!session) throw new Error("No session");
  const result = await executeOperation(
    counted.repository.forSession(session.user.id, session.session.id),
    { operation: "getMe", params: {} },
    context,
  );
  expect(responseSchemas.getMe.parse(result.data)).toMatchObject({
    user: { id: own.user, displayName: "Current user" },
    memberships: [{ teamId: own.team, role: "owner", teamName: "Current team" }],
  });
  expect(result.changedTeams).toEqual([]);
  expect(queryCount).toBe(4);

  await c.query(sql`DELETE FROM auth_session WHERE id=${sessionId}`);
  expect(await auth.api.getSession({ headers })).toBeNull();
  expect(queryCount).toBe(5);
});

it("resolves the current role again and keeps the team fixed after it is selected", async () => {
  const repo = c.repository.forSession(own.user, sessionId);
  expect(await repo.ResolveMembershipByUserID(own.user)).toEqual({
    TeamID: own.team,
    Role: "owner",
    TeamName: "Current team",
  });
  const scoped = repo.forMember(own.team, own.user);
  await c.query(sql`UPDATE team_members SET role='member' WHERE user_id=${own.user}`);
  expect(await scoped.ResolveMembershipByUserID(own.user)).toMatchObject({ Role: "member" });
  await c.query(sql`UPDATE team_members SET team_id=${other.team} WHERE user_id=${own.user}`);
  await expect(scoped.ResolveMembershipByUserID(own.user)).rejects.toMatchObject({ status: 403 });
  expect(await repo.ResolveMembershipByUserID(own.user)).toMatchObject({ TeamID: other.team });
});

it.each(["revoked", "expired", "removed"])(
  "distinguishes %s access from an empty membership result",
  async (change) => {
    const repo = c.repository.forSession(own.user, sessionId);
    const scoped = repo.forMember(own.team, own.user);
    if (change === "revoked") await c.query(sql`DELETE FROM auth_session WHERE id=${sessionId}`);
    if (change === "expired")
      await c.query(sql`UPDATE auth_session SET expires_at='2000-01-01T00:00:00.000Z'
        WHERE id=${sessionId}`);
    if (change === "removed")
      await c.query(sql`DELETE FROM team_members WHERE user_id=${own.user}`);
    for (const candidate of [repo, scoped])
      await expect(candidate.ResolveMembershipByUserID(own.user)).rejects.toMatchObject({
        status: change === "removed" ? 403 : 401,
      });
  },
);

it("does not resolve a different identity, including another member of the same team", async () => {
  const repo = c.repository.forSession(own.user, sessionId);
  await expect(repo.ResolveMembershipByUserID(other.user)).rejects.toMatchObject({ status: 403 });
  await expect(
    c.repository.forSession(other.user, sessionId).ResolveMembershipByUserID(other.user),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    repo.forMember(other.team, other.user).ResolveMembershipByUserID(other.user),
  ).rejects.toMatchObject({ status: 401 });
  await c.query(sql`UPDATE team_members SET team_id=${own.team} WHERE user_id=${other.user}`);
  try {
    await expect(
      repo.forMember(own.team, own.user).ResolveMembershipByUserID(other.user),
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    await c.query(sql`UPDATE team_members SET team_id=${other.team} WHERE user_id=${other.user}`);
  }
});

it.each([
  { operation: "getMe", change: "revoked", status: 401 },
  { operation: "getMe", change: "moved", status: 403 },
  { operation: "listTasks", change: "revoked", status: 401 },
  { operation: "listTasks", change: "moved", status: 403 },
] as const)(
  "rejects $operation when access is $change after the protected read",
  async ({ operation, change, status }) => {
    const repo = c.repository.forSession(own.user, sessionId);
    const scoped = repo.forMember(own.team, own.user);
    const memberBoundary = vi.spyOn(repo, "forMember").mockReturnValueOnce(scoped);
    const invalidate = async () => {
      if (change === "revoked") await c.query(sql`DELETE FROM auth_session WHERE id=${sessionId}`);
      else
        await c.query(sql`UPDATE team_members SET team_id=${other.team} WHERE user_id=${own.user}`);
    };
    const profile = scoped.GetUserByID.bind(scoped);
    const list = scoped.ListTasksByTeamID.bind(scoped);
    const readBoundary =
      operation === "getMe"
        ? vi.spyOn(scoped, "GetUserByID").mockImplementationOnce(async (id) => {
            const user = await profile(id);
            await invalidate();
            return user;
          })
        : vi.spyOn(scoped, "ListTasksByTeamID").mockImplementationOnce(async (team) => {
            const tasks = await list(team);
            expect(tasks).toEqual([]);
            await invalidate();
            return tasks;
          });
    try {
      await expect(
        executeOperation(repo, { operation, params: {} }, context),
      ).rejects.toMatchObject({ status });
      expect(readBoundary).toHaveBeenCalledOnce();
    } finally {
      readBoundary.mockRestore();
      memberBoundary.mockRestore();
    }
  },
);

it("still returns a genuinely empty authorized list", async () => {
  expect(
    await executeOperation(
      c.repository.forSession(own.user, sessionId),
      { operation: "listTasks", params: {} },
      context,
    ),
  ).toEqual({ data: { items: [] }, changedTeams: [] });
});
