import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase } from "../helpers/d1";
import { provisionUser } from "../../src/server/application/provision-user";
import { executeOperation } from "../../src/server/application/operations";
import { operationSchema, responseSchemas } from "../../src/contracts/operations";
import { closeOutstanding } from "../../src/server/application/jobs";
import { createAuth } from "../../src/server/infrastructure/auth";
describe("D1 and business operations", () => {
  let connection: Awaited<ReturnType<typeof createTestDatabase>>;
  const id = crypto.randomUUID(),
    secondId = crypto.randomUUID();
  const now = new Date("2026-09-14T03:00:00Z");
  let teamId: string;
  let taskId: string;
  async function run(operation: string, body?: unknown, params = {}) {
    const input = operationSchema.parse({ operation, body, params });
    const result = await executeOperation(connection.repository, input, {
      userId: id,
      now,
      vapidPublicKey: "test",
    });
    responseSchemas[input.operation].parse(result.data);
    teamId = (await connection.repository.ListMembershipsByUserID(id))[0].TeamID;
    return result.data;
  }
  beforeAll(async () => {
    connection = await createTestDatabase();
    for (const userId of [id, secondId]) {
      await connection.query(
        sql`INSERT INTO auth_user (id,name,email) VALUES (${userId},'Fixture',${userId + "@example.com"})`,
      );
      await connection.query(
        sql`INSERT INTO auth_account (id,user_id,provider_id,account_id) VALUES (${crypto.randomUUID()},${userId},'google',${userId})`,
      );
      await provisionUser(connection.repository, userId, now);
    }
    await run("getMe");
  });
  afterAll(async () => {
    if (!connection) return;
    const memberships = await connection.query(
      sql`SELECT team_id FROM team_members WHERE user_id IN (${id},${secondId})`,
    );
    for (const row of memberships.rows)
      await connection.query(sql`DELETE FROM teams WHERE id=${row.team_id}`);
    await connection.query(sql`DELETE FROM auth_user WHERE id IN (${id},${secondId})`);
    await connection.close();
  });
  it("provisions the same UUID and initial team idempotently", async () => {
    await provisionUser(connection.repository, id, now);
    expect(await connection.repository.ListMembershipsByUserID(id)).toHaveLength(1);
  });
  it("creates, completes, updates and preserves task DTO shapes", async () => {
    const task = (await run("postTask", { title: "掃除", type: "daily", penaltyPoints: 2 })) as {
      id: string;
    };
    taskId = task.id;
    expect(
      await run("postTaskCompletion", { targetDate: "2026-09-14", action: "complete" }, { taskId }),
    ).toMatchObject({ completed: true });
    await run("patchTask", { title: "台所掃除", notes: "台所" }, { taskId });
    await run("listTasks");
    await run("getTaskOverview");
    await run("getPenaltySummaryMonthly", undefined, { month: "2026-09" });
  });
  it("denies cross-team resource mutation", async () => {
    const input = operationSchema.parse({
      operation: "patchTask",
      params: { taskId },
      body: { title: "intrusion" },
    });
    await expect(
      executeOperation(connection.repository, input, { userId: secondId, now, vapidPublicKey: "" }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("keeps shopping, reminder and penalty contracts", async () => {
    const item = (await run("postShoppingItem", { name: "牛乳" })) as { id: string };
    await run("patchShoppingItem", { notes: "2本" }, { itemId: item.id });
    await run("listShoppingItems");
    await run("postShoppingItemsReorder", { itemIds: [item.id] });
    const reminder = (await run("postReminder", {
      title: "資源ごみ",
      kind: "recurring",
      scheduleType: "weekly",
      startDate: "2026-09-14",
    })) as { id: string };
    await run("listReminders", undefined, { from: "2026-09-01", to: "2026-09-30" });
    await run("listReminderDefinitions");
    await run("patchReminder", { notes: "朝" }, { reminderId: reminder.id });
    // The edit form clears recurring fields with null when switching to one-time.
    await run(
      "patchReminder",
      { kind: "one_time", scheduleType: null, endDate: null },
      {
        reminderId: reminder.id,
      },
    );
    expect(await connection.repository.GetReminderByID(reminder.id)).toMatchObject({
      Kind: "one_time",
      ScheduleType: null,
      EndDate: null,
    });
    await run("listReminderDefinitions");
    const rule = (await run("postPenaltyRule", { name: "おやつ", threshold: 2 })) as { id: string };
    await run("patchPenaltyRule", { description: "買う" }, { ruleId: rule.id });
    await run("listPenaltyRules");
    await run("deletePenaltyRule", undefined, { ruleId: rule.id });
    await run("deleteReminder", undefined, { reminderId: reminder.id });
    await run("deleteShoppingItem", undefined, { itemId: item.id });
  });
  it("commits closing periods once, then resumes without double counting", async () => {
    await connection.query(
      sql`UPDATE tasks SET created_at='2026-09-12T00:00:00Z' WHERE id=${taskId}`,
    );
    await closeOutstanding(connection.repository, "day", now);
    const first = await connection.repository.GetMonthlyPenaltySummary({
      TeamID: teamId,
      MonthStart: "2026-09-01",
    });
    await closeOutstanding(connection.repository, "day", now);
    expect(
      await connection.repository.GetMonthlyPenaltySummary({
        TeamID: teamId,
        MonthStart: "2026-09-01",
      }),
    ).toEqual(first);
    expect(first.DailyPenaltyTotal).toBe(4);
    await run("getMe");
  });
  it("retains five database sessions and rejects unauthenticated requests", async () => {
    const auth = createAuth(connection.db, {
      baseURL: "http://localhost:5174",
      secret: "test-secret-32-characters-at-least-not-production",
      googleClientId: "test",
      googleClientSecret: "test",
      allowedEmails: ["someone-else@example.com"],
    });
    for (let i = 0; i < 6; i++)
      await connection.query(
        sql`INSERT INTO auth_session(id,token,user_id,expires_at,created_at) VALUES (${crypto.randomUUID()},${id + "-" + i},${id},strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days'),strftime('%Y-%m-%dT%H:%M:%fZ','now',${i + " seconds"}))`,
      );
    const rows = await connection.query(sql`SELECT token FROM auth_session WHERE user_id=${id}`);
    expect(rows.rows).toHaveLength(5);
    expect(rows.rows.some((r) => r.token === id + "-0")).toBe(false);
    const session = await auth.api.getSession({ headers: new Headers() });
    expect(session).toBeNull();
  });
  it("keeps provider and database details out of authentication logs", async () => {
    const auth = createAuth(connection.db, {
      baseURL: "https://app.example.com",
      secret: "logging-test-secret-at-least-32-characters",
      googleClientId: "test",
      googleClientSecret: "test",
      allowedEmails: ["allowed@example.com"],
    });
    const context = await auth.$context;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      context.logger.error("OAuth token: private-token", new Error("SQL private-query"));
      context.logger.warn("private-email@example.com", { accessToken: "private-token" });
      expect(error).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({ event: "auth_library_log", level: "error" }),
      );
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({ event: "auth_library_log", level: "warn" }),
      );
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });
  it("keeps the session limit under simultaneous logins with identical timestamps", async () => {
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        const other = connection;
        try {
          await other.query(sql`INSERT INTO auth_session(id,token,user_id,expires_at,created_at)
          VALUES (${crypto.randomUUID()},${crypto.randomUUID()},${id},strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days'),${"2026-09-14T03:00:00.000Z"})`);
        } finally {
          // Shared test D1 binding remains owned by this suite.
        }
      }),
    );
    const rows = await connection.query(sql`SELECT id FROM auth_session WHERE user_id=${id}`);
    expect(rows.rows).toHaveLength(5);
  });
  it("enforces signup allowlists but lets registered identities create sessions, revoke and log out", async () => {
    const secret = "integration-only-secret-at-least-32-characters";
    const auth = createAuth(connection.db, {
      baseURL: "https://app.example.com",
      secret,
      googleClientId: "test",
      googleClientSecret: "test",
      allowedEmails: ["allowed@example.com"],
    });
    const context = await auth.$context;
    await expect(
      context.internalAdapter.createUser(
        {
          name: "Denied",
          email: "denied@example.com",
          emailVerified: true,
        },
        { method: "oauth", oauth: { providerId: "google" } },
      ),
    ).rejects.toThrow();
    const session = await context.internalAdapter.createSession(id);
    if (!session) throw new Error("Session was not created");
    expect(session.userId).toBe(id);
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBeGreaterThan(
      29.99 * 86400000,
    );
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBeLessThanOrEqual(
      30.01 * 86400000,
    );
    const cookie = `__Secure-better-auth.session_token=${encodeURIComponent(session.token + "." + createHmac("sha256", secret).update(session.token).digest("base64"))}`;
    const headers = new Headers({ cookie, origin: "https://app.example.com" });
    expect((await auth.api.getSession({ headers }))?.user.id).toBe(id);
    const response = await auth.handler(
      new Request("https://app.example.com/api/auth/sign-out", { method: "POST", headers }),
    );
    expect(response.status).toBe(200);
    expect(await auth.api.getSession({ headers })).toBeNull();
  });

  it("provisions an allowlisted new Google identity and its team once", async () => {
    const email = crypto.randomUUID() + "@example.com";
    const auth = createAuth(connection.db, {
      baseURL: "http://localhost:5174",
      secret: "new-user-integration-secret-at-least-32-characters",
      googleClientId: "test",
      googleClientSecret: "test",
      allowedEmails: [email],
    });
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser(
      {
        name: "New user",
        email,
        emailVerified: true,
      },
      { method: "oauth", oauth: { providerId: "google" } },
    );
    try {
      await context.internalAdapter.createAccount({
        userId: user.id,
        providerId: "google",
        accountId: "subject-" + user.id,
      });
      await context.internalAdapter.createSession(user.id);
      await context.internalAdapter.createSession(user.id);
      const members = await connection.repository.ListMembershipsByUserID(user.id);
      expect(members).toHaveLength(1);
      expect((await connection.repository.GetUserByID(user.id)).ID).toBe(user.id);
    } finally {
      for (const member of await connection.repository.ListMembershipsByUserID(user.id))
        await connection.query(sql`DELETE FROM teams WHERE id=${member.TeamID}`);
      await connection.query(sql`DELETE FROM auth_user WHERE id=${user.id}`);
    }
  });
  it("includes a recurring reminder on a single-day inclusive calendar range", async () => {
    const reminder = (await run("postReminder", {
      title: "当日の予定",
      kind: "recurring",
      scheduleType: "weekly",
      startDate: "2026-09-14",
    })) as { id: string };
    const result = (await run("listReminders", undefined, {
      from: "2026-09-14",
      to: "2026-09-14",
    })) as { days: { date: string; items: { reminderId: string }[] }[] };
    expect(result.days).toEqual([
      { date: "2026-09-14", items: [expect.objectContaining({ reminderId: reminder.id })] },
    ]);
    await run("deleteReminder", undefined, { reminderId: reminder.id });
  });
  it("joins another team, rejects member invites and transfers ownership on departure", async () => {
    const oldTeam = teamId;
    const invitation = (await run("postTeamInvite", {})) as { code: string };
    async function asSecond(operation: string, body?: unknown) {
      return executeOperation(connection.repository, operationSchema.parse({ operation, body }), {
        userId: secondId,
        now,
        vapidPublicKey: "",
      });
    }
    await asSecond("postTeamJoin", { code: invitation.code });
    expect((await connection.repository.ListMembershipsByUserID(secondId))[0]).toMatchObject({
      TeamID: oldTeam,
      Role: "member",
    });
    await expect(asSecond("postTeamInvite", {})).rejects.toMatchObject({ status: 403 });
    await run("getMe");
    await run("patchTask", { assigneeUserId: id }, { taskId });
    const endpoint = `https://web.push.apple.com/review-${id}`;
    const subscription = (await run("postPushSubscription", {
      endpoint,
      keys: { p256dh: "test-key", auth: "test-auth" },
      platform: "ios_safari_pwa",
    })) as { id: string };
    await run("postTeamLeave");
    expect(
      (await connection.repository.ListPushSubscriptionsByUserID(id)).find(
        (s) => s.ID === subscription.id,
      )?.IsActive,
    ).toBe(false);
    expect(await connection.repository.ListActivePushSubscriptionsByTeamID(oldTeam)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ UserID: id })]),
    );
    const movedSubscription = (await run("postPushSubscription", {
      endpoint,
      keys: { p256dh: "test-key", auth: "test-auth" },
      platform: "ios_safari_pwa",
    })) as { teamId: string };
    expect(movedSubscription.teamId).toBe(teamId);
    expect(teamId).not.toBe(oldTeam);
    expect((await connection.repository.ListMembershipsByUserID(secondId))[0]).toMatchObject({
      TeamID: oldTeam,
      Role: "owner",
    });
    expect((await connection.repository.GetTaskByID(taskId)).AssigneeUserID).toBe("");
    await expect(
      run("patchTask", { title: "old team mutation" }, { taskId }),
    ).rejects.toMatchObject({ status: 404 });
    await asSecond("postTeamInvite", {});
  });
});
