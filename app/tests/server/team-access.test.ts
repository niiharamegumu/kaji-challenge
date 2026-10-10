import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Repository } from "../../src/server/application/ports";
import { createTestDatabase } from "../helpers/d1";
import { executeOperation } from "../../src/server/application/operations";

type Fixture = {
  user: string;
  team: string;
  daily: string;
  weekly: string;
  todo: string;
  category: string;
  reminder: string;
  penalty: string;
  push: string;
};
const fixture = (): Fixture =>
  Object.fromEntries(
    ["user", "team", "daily", "weekly", "todo", "category", "reminder", "penalty", "push"].map(
      (key) => [key, crypto.randomUUID()],
    ),
  ) as Fixture;
const own = fixture(),
  other = fixture();
const sessionId = crypto.randomUUID();
const now = "2026-09-25T00:00:00.000Z",
  date = "2026-09-25",
  week = "2026-09-21",
  month = "2026-09-01";
let c: Awaited<ReturnType<typeof createTestDatabase>>;
const tables = [
  "teams",
  "team_members",
  "tasks",
  "todo_items",
  "reminders",
  "penalty_rules",
  "invite_codes",
  "task_completion_daily",
  "task_completion_weekly_entries",
  "monthly_penalty_summaries",
  "monthly_penalty_summary_triggered_rules",
  "close_runs",
  "push_subscriptions",
  "auth_user",
];
const snapshot = () =>
  Promise.all(
    tables.map((table) => c.db.all(sql`SELECT * FROM ${sql.identifier(table)} ORDER BY rowid`)),
  );
const task = (f: Fixture) => ({
  ID: crypto.randomUUID(),
  TeamID: f.team,
  Title: "New",
  Notes: null,
  Type: "daily",
  PenaltyPoints: 1,
  AssigneeUserID: "",
  RequiredCompletionsPerWeek: 1,
  SortKey: 100,
  CreatedAt: now,
  UpdatedAt: now,
});
const completion = (f: Fixture) => ({
  teamId: f.team,
  userId: own.user,
  taskId: f.daily,
  type: "daily" as const,
  target: date,
  action: "incomplete" as const,
  cutoff: "2026-09-25T15:00:00.000Z",
  now,
  recalculateMonth: "2026-09",
  ensureCoverage: true,
});

beforeAll(async () => {
  c = await createTestDatabase();
  for (const f of [own, other]) {
    await c.query(
      sql`INSERT INTO auth_user(id,name,email) VALUES (${f.user},'Private profile',${f.user + "@example.com"})`,
    );
    await c.repository.ProvisionUser(f.user, f.team, "Private team", now);
    for (const [id, type] of [
      [f.daily, "daily"],
      [f.weekly, "weekly"],
    ])
      await c.repository.CreateTask({
        ...task(f),
        ID: id,
        Type: type,
        CreatedAt: "2026-09-01T00:00:00.000Z",
      });
    await c.repository.CreateTodoCategory(f.team, { id: f.category, name: "Private category" });
    await c.repository.CreateTodoItem({
      ID: f.todo,
      TeamID: f.team,
      Name: "Private item",
      Notes: null,
      CategoryID: f.category,
      SortKey: 100,
      CreatedAt: now,
      UpdatedAt: now,
    });
    await c.repository.CreateReminder({
      ID: f.reminder,
      TeamID: f.team,
      Title: "Private reminder",
      Notes: null,
      Kind: "one_time",
      ScheduleType: null,
      StartDate: date,
      EndDate: null,
      CreatedAt: now,
      UpdatedAt: now,
    });
    await c.repository.CreatePenaltyRule({
      ID: f.penalty,
      TeamID: f.team,
      Name: "Private penalty",
      Threshold: 1,
      Description: null,
      CreatedAt: "2026-09-01T00:00:00.000Z",
      UpdatedAt: now,
    });
    await c.repository.ReplaceInvite(
      { Code: f.team, TeamID: f.team, ExpiresAt: "2099-01-01T00:00:00.000Z" },
      f.user,
    );
    await c.repository.UpsertPushSubscription({
      ID: f.push,
      TeamID: f.team,
      UserID: f.user,
      Endpoint: "https://fcm.googleapis.com/" + f.push,
      P256dh: "fixture-key",
      Auth: "fixture-auth",
      UserAgent: "",
      Platform: "ios_safari_pwa",
      LastSeenAt: now,
      CreatedAt: now,
      UpdatedAt: now,
    });
    await c.repository.SetCompletion({ ...completion(f), userId: f.user, action: "complete" });
    await c.repository.SetCompletion({
      ...completion(f),
      userId: f.user,
      taskId: f.weekly,
      type: "weekly",
      target: week,
      action: "complete",
    });
    await c.repository.ClosePeriod(f.team, "day", date);
    await c.query(sql`INSERT INTO monthly_penalty_summary_triggered_rules(team_id,month_start,rule_id,created_at)
      VALUES (${f.team},${month},${f.penalty},${now})`);
  }
});
beforeEach(async () => {
  await c.query(
    sql`INSERT INTO team_members(team_id,user_id,role,created_at) VALUES (${own.team},${own.user},'owner',${now})
      ON CONFLICT(user_id) DO UPDATE SET team_id=excluded.team_id,role=excluded.role`,
  );
  await c.query(sql`INSERT INTO auth_session(id,token,user_id,expires_at)
    VALUES (${sessionId},${sessionId},${own.user},${new Date(Date.now() + 3600_000).toISOString()})
    ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at`);
});
afterAll(async () => {
  await c?.close();
});

type ReadCase = {
  name: string;
  run: (r: Repository, f: Fixture) => Promise<unknown>;
  denied?: unknown;
};
const reads: ReadCase[] = [
  { name: "GetTaskByID", run: (r, f) => r.GetTaskByID(f.daily) },
  { name: "ListTasksByTeamID", run: (r, f) => r.ListTasksByTeamID(f.team), denied: [] },
  {
    name: "GetEarliestTaskCreatedAtByTeam",
    run: (r, f) => r.GetEarliestTaskCreatedAtByTeam(f.team),
    denied: "",
  },
  {
    name: "ListTasksEffectiveForCloseByTeamAndType",
    run: (r, f) =>
      r.ListTasksEffectiveForCloseByTeamAndType({ TeamID: f.team, Type: "daily", CreatedAt: now }),
    denied: [],
  },
  {
    name: "ListTasksForMonthlyStatusByTeam",
    run: (r, f) =>
      r.ListTasksForMonthlyStatusByTeam({ TeamID: f.team, CreatedAt: now, DeletedAt: month }),
    denied: [],
  },
  {
    name: "GetTaskCompletionWeeklyEntryCount",
    run: (r, f) => r.GetTaskCompletionWeeklyEntryCount({ TaskID: f.weekly, WeekStart: week }),
    denied: 0,
  },
  {
    name: "HasTaskCompletionDaily",
    run: (r, f) => r.HasTaskCompletionDaily({ TaskID: f.daily, TargetDate: date }),
    denied: false,
  },
  {
    name: "ListTaskCompletionDailyByMonthAndTeam",
    run: (r, f) =>
      r.ListTaskCompletionDailyByMonthAndTeam({
        TeamID: f.team,
        TargetDate: month,
        BeforeDate: "2026-10-01",
      }),
    denied: [],
  },
  {
    name: "ListTaskCompletionDailyByTeamAndDate",
    run: (r, f) => r.ListTaskCompletionDailyByTeamAndDate({ TeamID: f.team, TargetDate: date }),
    denied: [],
  },
  {
    name: "ListTaskCompletionWeeklyCountsByTeamAndWeek",
    run: (r, f) =>
      r.ListTaskCompletionWeeklyCountsByTeamAndWeek({ TeamID: f.team, WeekStart: week }),
    denied: [],
  },
  {
    name: "ListTaskCompletionWeeklySlotsByMonthAndTeam",
    run: (r, f) =>
      r.ListTaskCompletionWeeklySlotsByMonthAndTeam({
        TeamID: f.team,
        WeekStart: week,
        BeforeWeekStart: "2026-10-01",
      }),
    denied: [],
  },
  {
    name: "ListTaskCompletionWeeklySlotsByTeamAndWeek",
    run: (r, f) =>
      r.ListTaskCompletionWeeklySlotsByTeamAndWeek({ TeamID: f.team, WeekStart: week }),
    denied: [],
  },
  { name: "ListTeamMembersByTeamID", run: (r, f) => r.ListTeamMembersByTeamID(f.team), denied: [] },
  { name: "GetLatestInviteCodeByTeamID", run: (r, f) => r.GetLatestInviteCodeByTeamID(f.team) },
  { name: "ListTodoCategories", run: (r, f) => r.ListTodoCategories(f.team) },
  { name: "GetTodoItemByID", run: (r, f) => r.GetTodoItemByID(f.todo) },
  { name: "ListTodoItemsByTeamID", run: (r, f) => r.ListTodoItemsByTeamID(f.team), denied: [] },
  { name: "GetReminderByID", run: (r, f) => r.GetReminderByID(f.reminder) },
  { name: "ListRemindersByTeamID", run: (r, f) => r.ListRemindersByTeamID(f.team), denied: [] },
  { name: "GetUndeletedPenaltyRuleByID", run: (r, f) => r.GetUndeletedPenaltyRuleByID(f.penalty) },
  {
    name: "ListPenaltyRulesByTeamID",
    run: (r, f) => r.ListPenaltyRulesByTeamID(f.team),
    denied: [],
  },
  {
    name: "ListUndeletedPenaltyRulesByTeamID",
    run: (r, f) => r.ListUndeletedPenaltyRulesByTeamID(f.team),
    denied: [],
  },
  {
    name: "ListPenaltyRulesEffectiveAtByTeamID",
    run: (r, f) => r.ListPenaltyRulesEffectiveAtByTeamID({ TeamID: f.team, AsOf: now }),
    denied: [],
  },
  {
    name: "GetMonthlyPenaltySummary",
    run: (r, f) => r.GetMonthlyPenaltySummary({ TeamID: f.team, MonthStart: month }),
  },
  {
    name: "ListTriggeredRuleIDsByMonth",
    run: (r, f) => r.ListTriggeredRuleIDsByMonth({ TeamID: f.team, MonthStart: month }),
    denied: [],
  },
  {
    name: "GetLatestCloseRunTargetDate",
    run: (r, f) => r.GetLatestCloseRunTargetDate({ TeamID: f.team, Scope: "close_day" }),
    denied: "",
  },
  {
    name: "FindOldestMonthCloseCandidate",
    run: (r, f) =>
      r.FindOldestMonthCloseCandidate({ TeamID: f.team, CurrentMonthStart: "2026-10-01" }),
  },
  { name: "GetUserByID", run: (r, f) => r.GetUserByID(f.user) },
  {
    name: "ListPushSubscriptionsByUserID",
    run: (r, f) => r.ListPushSubscriptionsByUserID(f.user),
    denied: [],
  },
];
type WriteCase = { name: string; run: (r: Repository, f: Fixture) => Promise<unknown> };
const writes: WriteCase[] = [
  { name: "UpdateTeamName", run: (r, f) => r.UpdateTeamName({ ID: f.team, Name: "Changed" }) },
  { name: "CreateTask", run: (r, f) => r.CreateTask(task(f)) },
  {
    name: "UpdateTask",
    run: (r, f) => r.UpdateTask({ ID: f.daily, Title: "Changed", UpdatedAt: now }),
  },
  { name: "DeleteTask", run: (r, f) => r.DeleteTask(f.daily) },
  {
    name: "CreateTodoCategory",
    run: (r, f) => r.CreateTodoCategory(f.team, { id: crypto.randomUUID(), name: "Changed" }),
  },
  {
    name: "RenameTodoCategory",
    run: (r, f) => r.RenameTodoCategory(f.team, f.category, "Changed"),
  },
  {
    name: "ReorderTodoCategories",
    run: (r, f) => r.ReorderTodoCategories(f.team, [f.category, null]),
  },
  { name: "DeleteTodoCategory", run: (r, f) => r.DeleteTodoCategory(f.team, f.category, now) },
  {
    name: "Reorder tasks",
    run: (r, f) =>
      r.Reorder({
        teamId: f.team,
        kind: "tasks",
        type: "daily",
        ids: [f.daily],
        now: "2026-09-26T00:00:00.000Z",
      }),
  },
  {
    name: "Reorder todos",
    run: (r, f) =>
      r.Reorder({ teamId: f.team, kind: "todo", ids: [f.todo], now: "2026-09-26T00:00:00.000Z" }),
  },
  {
    name: "CreateReminder",
    run: (r, f) =>
      r.CreateReminder({
        ID: crypto.randomUUID(),
        TeamID: f.team,
        Title: "Changed",
        Notes: null,
        Kind: "one_time",
        ScheduleType: null,
        StartDate: date,
        EndDate: null,
        CreatedAt: now,
        UpdatedAt: now,
      }),
  },
  {
    name: "UpdateReminder",
    run: (r, f) => r.UpdateReminder({ ID: f.reminder, Title: "Changed", UpdatedAt: now }),
  },
  { name: "DeleteReminder", run: (r, f) => r.DeleteReminder(f.reminder) },
  {
    name: "DeleteExpiredOneTimeRemindersByTeam",
    run: (r, f) =>
      r.DeleteExpiredOneTimeRemindersByTeam({ TeamID: f.team, StartDate: "2026-10-01" }),
  },
  {
    name: "CreatePenaltyRule",
    run: (r, f) =>
      r.CreatePenaltyRule({
        ID: crypto.randomUUID(),
        TeamID: f.team,
        Name: "Changed",
        Threshold: 77,
        Description: null,
        CreatedAt: now,
        UpdatedAt: now,
      }),
  },
  {
    name: "UpdatePenaltyRule",
    run: (r, f) => r.UpdatePenaltyRule({ ID: f.penalty, Name: "Changed", UpdatedAt: now }),
  },
  {
    name: "SoftDeletePenaltyRule",
    run: (r, f) => r.SoftDeletePenaltyRule({ ID: f.penalty, DeletedAt: now }),
  },
  { name: "SetCompletion", run: (r, f) => r.SetCompletion(completion(f)) },
  {
    name: "RecalculateMonth",
    run: (r, f) =>
      r.RecalculateMonth({
        teamId: f.team,
        month: "2026-09",
        ensureCoverage: true,
        closeMonth: true,
      }),
  },
  {
    name: "UpdateUserNickname",
    run: (r, f) => r.UpdateUserNickname({ ID: f.user, Nickname: "Changed" }),
  },
  {
    name: "UpdateUserColorHex",
    run: (r, f) => r.UpdateUserColorHex({ ID: f.user, ColorHex: "#123456" }),
  },
  {
    name: "DeactivatePushSubscriptionByIDAndUser",
    run: (r, f) =>
      r.DeactivatePushSubscriptionByIDAndUser({ ID: f.push, UserID: f.user, UpdatedAt: now }),
  },
  {
    name: "CreateTodoItem",
    run: (r, f) =>
      r.CreateTodoItem({
        ID: crypto.randomUUID(),
        TeamID: f.team,
        Name: "Changed",
        Notes: null,
        CategoryID: f.category,
        SortKey: 100,
        CreatedAt: now,
        UpdatedAt: now,
      }),
  },
  {
    name: "UpdateTodoItem",
    run: (r, f) =>
      r.UpdateTodoItem({ ID: f.todo, TeamID: f.team, Name: "Changed", UpdatedAt: now }),
  },
  { name: "DeleteTodoItem", run: (r, f) => r.DeleteTodoItem(f.todo) },
  {
    name: "UpsertPushSubscription",
    run: (r, f) =>
      r.UpsertPushSubscription({
        ID: crypto.randomUUID(),
        TeamID: f.team,
        UserID: f.user,
        Endpoint: "https://fcm.googleapis.com/changed",
        P256dh: "new-fixture-key",
        Auth: "new-fixture-auth",
        UserAgent: "",
        Platform: "ios_safari_pwa",
        LastSeenAt: now,
        CreatedAt: now,
        UpdatedAt: now,
      }),
  },
  {
    name: "ReplaceInvite",
    run: (r, f) =>
      r.ReplaceInvite(
        { Code: crypto.randomUUID(), TeamID: f.team, ExpiresAt: "2099-01-01T00:00:00.000Z" },
        f.user,
      ),
  },
  {
    name: "MoveMember",
    run: (r, f) =>
      r.MoveMember({
        userId: f.user,
        fromTeamId: f.team,
        toTeamId: f === own ? other.team : own.team,
        inviteCode: f === own ? other.team : own.team,
        now,
      }),
  },
];

describe.each(["foreign", "moved", "removed", "revoked", "expired"] as const)(
  "SQL denies %s access",
  (mode) => {
    async function deniedContext() {
      const repo = c.repository.forSession(own.user, sessionId).forMember(own.team, own.user);
      if (mode === "moved")
        await c.query(sql`UPDATE team_members SET team_id=${other.team} WHERE user_id=${own.user}`);
      if (mode === "removed")
        await c.query(sql`DELETE FROM team_members WHERE user_id=${own.user}`);
      if (mode === "revoked") await c.query(sql`DELETE FROM auth_session WHERE id=${sessionId}`);
      if (mode === "expired")
        await c.query(
          sql`UPDATE auth_session SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=${sessionId}`,
        );
      return { repo, target: mode === "foreign" ? other : own };
    }
    it.each(reads)("$name returns no protected data", async (test) => {
      const { repo, target } = await deniedContext();
      if ("denied" in test) expect(await test.run(repo, target)).toEqual(test.denied);
      else await expect(test.run(repo, target)).rejects.toMatchObject({ status: 404 });
    });
    it.each(writes)("$name leaves both teams unchanged", async (test) => {
      const { repo, target } = await deniedContext();
      const before = await snapshot();
      try {
        const value = await test.run(repo, target);
        if (test.name === "SetCompletion") expect(value).toBe(0);
      } catch (error) {
        expect(error).toMatchObject({ status: expect.any(Number) });
        expect([401, 403, 404, 409]).toContain((error as { status: number }).status);
      }
      expect(await snapshot()).toEqual(before);
    });
  },
);

it.each(reads)("$name still reads current-team data", async (test) => {
  const value = await test.run(
    c.repository.forSession(own.user, sessionId).forMember(own.team, own.user),
    own,
  );
  expect(value).toBeDefined();
  if ("denied" in test) expect(value).not.toEqual(test.denied);
});

it("requires current authentication for invite lookup while allowing a valid join capability", async () => {
  const repo = c.repository.forSession(own.user, sessionId).forMember(own.team, own.user);
  expect(await repo.GetInviteCode(other.team)).toMatchObject({ TeamID: other.team });
  await c.query(sql`DELETE FROM auth_session WHERE id=${sessionId}`);
  await expect(repo.GetInviteCode(other.team)).rejects.toMatchObject({ status: 404 });
  expect(await repo.ListMembershipsByUserID(own.user)).toEqual([]);
});

it("does not substitute another user's membership or profile, even in the same team", async () => {
  const repo = c.repository.forSession(own.user, sessionId).forMember(own.team, own.user);
  await c.query(sql`UPDATE team_members SET team_id=${own.team} WHERE user_id=${other.user}`);
  try {
    const before = await snapshot();
    expect(await repo.ListMembershipsByUserID(other.user)).toEqual([]);
    await expect(repo.GetUserByID(other.user)).rejects.toMatchObject({ status: 404 });
    await repo.UpdateUserNickname({ ID: other.user, Nickname: "Impostor" });
    expect(
      await repo.DeactivatePushSubscriptionByIDAndUser({
        ID: other.push,
        UserID: other.user,
        UpdatedAt: now,
      }),
    ).toBe(0);
    expect(await snapshot()).toEqual(before);
    expect(await repo.ListTeamMembersByTeamID(own.team)).toHaveLength(2);
  } finally {
    await c.query(sql`UPDATE team_members SET team_id=${other.team} WHERE user_id=${other.user}`);
  }
});

it("does not record a completion on behalf of another team member", async () => {
  const before = await snapshot();
  await c.repository
    .forSession(own.user, sessionId)
    .forMember(own.team, own.user)
    .SetCompletion({ ...completion(own), userId: other.user });
  expect(await snapshot()).toEqual(before);
});

it.each(["create", "update"])(
  "rejects a foreign assignee at the task %s SQL without shifting or editing tasks",
  async (kind) => {
    const scoped = c.repository.forSession(own.user, sessionId).forMember(own.team, own.user);
    const before = await snapshot();
    await expect(
      kind === "create"
        ? scoped.CreateTask({ ...task(own), AssigneeUserID: other.user })
        : scoped.UpdateTask({ ID: own.daily, AssigneeUserID: other.user, UpdatedAt: now }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await snapshot()).toEqual(before);
  },
);

it("does not let an authenticated repository bypass membership resolution or substitute the actor", async () => {
  const repo = c.repository.forSession(own.user, sessionId);
  expect(await repo.ListTasksByTeamID(own.team)).toEqual([]);
  expect(await repo.forMember(other.team, other.user).ListTasksByTeamID(other.team)).toEqual([]);
  const scoped = repo.forMember(own.team, own.user);
  expect(() => scoped.forMember(other.team, own.user)).toThrow();
  expect(() => scoped.forSession(other.user, sessionId)).toThrow();
});

it("checks owner role again for both statements of invite replacement", async () => {
  const repo = c.repository.forSession(own.user, sessionId).forMember(own.team, own.user);
  await c.query(sql`UPDATE team_members SET role='member' WHERE user_id=${own.user}`);
  const before = await snapshot();
  await expect(
    repo.ReplaceInvite(
      { Code: "Denied", TeamID: own.team, ExpiresAt: "2099-01-01T00:00:00.000Z" },
      own.user,
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(await snapshot()).toEqual(before);
});

it("rejects an invite that naturally expires during the application lookup", async () => {
  const deadline = Date.now() + 60_000;
  const repo = c.repository.forSession(own.user, sessionId);
  const scoped = repo.forMember(own.team, own.user);
  const code = crypto.randomUUID().toUpperCase();
  await c.repository.ReplaceInvite(
    { Code: code, TeamID: other.team, ExpiresAt: new Date(deadline).toISOString() },
    other.user,
  );
  const before = await snapshot();
  const memberBoundary = vi.spyOn(repo, "forMember").mockReturnValue(scoped);
  const lookup = scoped.GetInviteCode.bind(scoped);
  const boundary = vi.spyOn(scoped, "GetInviteCode").mockImplementationOnce(async (value) => {
    const invite = await lookup(value);
    vi.setSystemTime(deadline);
    return invite;
  });
  // Keep a failing regression run from moving this suite's shared membership.
  const move = vi.spyOn(scoped, "MoveMember").mockResolvedValue();
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    await expect(
      executeOperation(
        repo,
        {
          operation: "postTeamJoin",
          params: {},
          body: { code },
        },
        { userId: own.user, now: new Date(), vapidPublicKey: "" },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(move).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  } finally {
    vi.useRealTimers();
    move.mockRestore();
    boundary.mockRestore();
    memberBoundary.mockRestore();
    await c.repository.ReplaceInvite(
      { Code: other.team, TeamID: other.team, ExpiresAt: "2099-01-01T00:00:00.000Z" },
      other.user,
    );
  }
});

it.each(["invite", "session"])(
  "leaves all move side effects unchanged when %s naturally expires before batch execution",
  async (kind) => {
    const clock = await c.db.get<{ now: string }>(
      sql`SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now`,
    );
    const deadline = new Date(Date.parse(clock!.now) + 1500).toISOString();
    await c.repository.ReplaceInvite(
      {
        Code: other.team,
        TeamID: other.team,
        ExpiresAt: kind === "invite" ? deadline : "2099-01-01T00:00:00.000Z",
      },
      other.user,
    );
    if (kind === "session")
      await c.query(sql`UPDATE auth_session SET expires_at=${deadline} WHERE id=${sessionId}`);
    const repo = c.repository.forSession(own.user, sessionId).forMember(own.team, own.user);
    await repo.assertAccess();
    const before = await snapshot();
    const batch = c.db.batch.bind(c.db);
    const boundary = vi.spyOn(c.db, "batch").mockImplementationOnce(async (queries) => {
      const start = await c.db.get<{ now: string }>(
        sql`SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now`,
      );
      expect(start!.now < deadline).toBe(true);
      await vi.waitFor(
        async () => {
          const row = await c.db.get<{ now: string }>(
            sql`SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now`,
          );
          expect(row!.now >= deadline).toBe(true);
        },
        { timeout: 5000, interval: 25 },
      );
      return batch(queries);
    });
    try {
      await expect(
        repo.MoveMember({
          userId: own.user,
          fromTeamId: own.team,
          toTeamId: other.team,
          inviteCode: other.team,
          now: clock!.now,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await snapshot()).toEqual(before);
    } finally {
      boundary.mockRestore();
      await c.repository.ReplaceInvite(
        { Code: other.team, TeamID: other.team, ExpiresAt: "2099-01-01T00:00:00.000Z" },
        other.user,
      );
    }
  },
);

it.each(["expired invite", "replaced invite", "wrong actor", "empty foreign team"])(
  "keeps all move side effects unchanged for %s",
  async (mode) => {
    const repo = c.repository.forSession(own.user, sessionId).forMember(own.team, own.user);
    const args = {
      userId: own.user,
      fromTeamId: own.team,
      toTeamId: other.team,
      inviteCode: other.team,
      now,
    };
    const emptyTeam = crypto.randomUUID();
    if (mode === "expired invite")
      await c.query(
        sql`UPDATE invite_codes SET expires_at='2000-01-01T00:00:00.000Z' WHERE team_id=${other.team}`,
      );
    if (mode === "replaced invite") args.inviteCode = crypto.randomUUID();
    if (mode === "wrong actor")
      Object.assign(args, {
        userId: other.user,
        fromTeamId: other.team,
        toTeamId: own.team,
        inviteCode: own.team,
      });
    if (mode === "empty foreign team") {
      await c.query(
        sql`INSERT INTO teams(id,name,created_at) VALUES (${emptyTeam},'Untouched',${now})`,
      );
      args.fromTeamId = emptyTeam;
    }
    try {
      const before = await snapshot();
      await expect(repo.MoveMember(args)).rejects.toMatchObject({ status: 409 });
      expect(await snapshot()).toEqual(before);
    } finally {
      await c.query(
        sql`UPDATE invite_codes SET expires_at='2099-01-01T00:00:00.000Z' WHERE team_id=${other.team}`,
      );
      await c.query(sql`DELETE FROM teams WHERE id=${emptyTeam}`);
    }
  },
);

it.each(["list", "mutation"])(
  "fails closed when membership moves immediately before an application %s SQL",
  async (kind) => {
    const repo = c.repository.forSession(own.user, sessionId);
    const scoped = repo.forMember(own.team, own.user);
    const boundary = vi.spyOn(repo, "forMember").mockReturnValueOnce(scoped);
    const move = async () => {
      await c.query(sql`UPDATE team_members SET team_id=${other.team} WHERE user_id=${own.user}`);
    };
    const list = scoped.ListTasksByTeamID.bind(scoped);
    const update = scoped.UpdateTask.bind(scoped);
    const competing =
      kind === "list"
        ? vi.spyOn(scoped, "ListTasksByTeamID").mockImplementationOnce(async (team) => {
            await move();
            return list(team);
          })
        : vi.spyOn(scoped, "UpdateTask").mockImplementationOnce(async (arg) => {
            await move();
            return update(arg);
          });
    try {
      const before = await c.repository.GetTaskByID(own.daily);
      await expect(
        executeOperation(
          repo,
          kind === "list"
            ? { operation: "listTasks", params: {} }
            : { operation: "patchTask", params: { taskId: own.daily }, body: { title: "Denied" } },
          { userId: own.user, now: new Date(now), vapidPublicKey: "" },
        ),
      ).rejects.toMatchObject({ status: kind === "list" ? 403 : 409 });
      expect(await c.repository.GetTaskByID(own.daily)).toEqual(before);
    } finally {
      competing.mockRestore();
      boundary.mockRestore();
    }
  },
);

it.each([
  { name: "ListTeamIDsForClose", run: (r: Repository) => r.ListTeamIDsForClose() },
  { name: "ListTeamIDsForPush", run: (r: Repository) => r.ListTeamIDsForPush() },
  {
    name: "ListActivePushSubscriptionsByTeamID",
    run: (r: Repository) => r.ListActivePushSubscriptionsByTeamID(own.team),
  },
  {
    name: "DeactivatePushSubscriptionByEndpoint",
    run: (r: Repository) =>
      r.DeactivatePushSubscriptionByEndpoint({
        Endpoint: "https://fcm.googleapis.com/" + own.push,
        UpdatedAt: now,
      }),
  },
  { name: "DeleteTeam", run: (r: Repository) => r.DeleteTeam(other.team) },
  { name: "ClosePeriod", run: (r: Repository) => r.ClosePeriod(other.team, "day", date) },
  {
    name: "ProvisionUser",
    run: (r: Repository) => r.ProvisionUser(own.user, crypto.randomUUID(), "Denied", now),
  },
])("does not expose trusted-system capability $name to a scoped caller", async (test) => {
  const before = await snapshot();
  for (const repo of [
    c.repository.forSession(own.user, sessionId),
    c.repository.forMember(own.team, own.user),
  ])
    await expect(test.run(repo)).rejects.toMatchObject({ status: 403 });
  expect(await snapshot()).toEqual(before);
});

it.each([false, true])(
  "preserves authenticated joins, owner handoff and empty-team cleanup (remaining member: %s)",
  async (remaining) => {
    const mover = crypto.randomUUID(),
      from = crypto.randomUUID(),
      session = crypto.randomUUID(),
      successor = crypto.randomUUID();
    await c.query(
      sql`INSERT INTO auth_user(id,name,email) VALUES (${mover},'Mover',${mover + "@example.com"})`,
    );
    await c.repository.ProvisionUser(mover, from, "From", now);
    if (remaining) {
      await c.query(
        sql`INSERT INTO auth_user(id,name,email) VALUES (${successor},'Successor',${successor + "@example.com"})`,
      );
      await c.query(
        sql`INSERT INTO team_members(team_id,user_id,role,created_at) VALUES (${from},${successor},'member',${now})`,
      );
    }
    await c.query(
      sql`INSERT INTO auth_session(id,token,user_id,expires_at) VALUES (${session},${session},${mover},'2099-01-01T00:00:00.000Z')`,
    );
    await c.repository.ReplaceInvite(
      { Code: other.team.toUpperCase(), TeamID: other.team, ExpiresAt: "2099-01-01T00:00:00.000Z" },
      other.user,
    );
    const repo = c.repository.forSession(mover, session);
    const joined = await executeOperation(
      repo,
      { operation: "postTeamJoin", body: { code: other.team }, params: {} },
      { userId: mover, now: new Date(now), vapidPublicKey: "" },
    );
    expect(joined.data).toEqual({ teamId: other.team });
    expect(await c.db.all(sql`SELECT id FROM teams WHERE id=${from}`)).toHaveLength(
      remaining ? 1 : 0,
    );
    if (remaining)
      expect(await c.repository.ListMembershipsByUserID(successor)).toEqual([
        { TeamID: from, TeamName: "From", Role: "owner" },
      ]);
    const left = await executeOperation(
      repo,
      { operation: "postTeamLeave", params: {} },
      { userId: mover, now: new Date(now), vapidPublicKey: "" },
    );
    expect((left.data as { teamId: string }).teamId).not.toBe(other.team);
    expect((await c.repository.ListMembershipsByUserID(mover))[0].Role).toBe("owner");
    expect(await c.db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
  },
);

it("rolls back owner handoff and other move effects when the membership statement fails", async () => {
  await c.repository.ReplaceInvite(
    { Code: "ROLLBACK-INVITE", TeamID: other.team, ExpiresAt: "2099-01-01T00:00:00.000Z" },
    other.user,
  );
  await c.query(
    sql`UPDATE team_members SET team_id=${own.team},role='member' WHERE user_id=${other.user}`,
  );
  await c.query(sql`CREATE TRIGGER reject_membership_move BEFORE UPDATE OF team_id ON team_members
    BEGIN SELECT RAISE(ABORT,'fixture move failure'); END`);
  try {
    const before = await snapshot();
    await expect(
      c.repository.forSession(own.user, sessionId).forMember(own.team, own.user).MoveMember({
        userId: own.user,
        fromTeamId: own.team,
        toTeamId: other.team,
        inviteCode: "ROLLBACK-INVITE",
        now,
      }),
    ).rejects.toThrow("fixture move failure");
    expect(await snapshot()).toEqual(before);
  } finally {
    await c.query(sql`DROP TRIGGER reject_membership_move`);
    await c.query(
      sql`UPDATE team_members SET team_id=${other.team},role='owner' WHERE user_id=${other.user}`,
    );
  }
});

it.each([0, 1])(
  "limits old-team device re-registration to the user's inactive subscription (active=%s)",
  async (active) => {
    const old = crypto.randomUUID(),
      endpoint = "https://fcm.googleapis.com/" + old;
    await c.repository.UpsertPushSubscription({
      ID: old,
      TeamID: other.team,
      UserID: own.user,
      Endpoint: endpoint,
      P256dh: "fixture-key",
      Auth: "fixture-auth",
      UserAgent: "",
      Platform: "ios_safari_pwa",
      LastSeenAt: now,
      CreatedAt: now,
      UpdatedAt: now,
    });
    await c.query(sql`UPDATE push_subscriptions SET is_active=${active} WHERE id=${old}`);
    const scoped = c.repository.forSession(own.user, sessionId).forMember(own.team, own.user);
    try {
      expect(
        (await scoped.ListPushSubscriptionsByUserID(own.user)).map((row) => row.ID),
      ).not.toContain(old);
      expect(
        await scoped.DeactivatePushSubscriptionByIDAndUser({
          ID: old,
          UserID: own.user,
          UpdatedAt: now,
        }),
      ).toBe(0);
      const foreignBefore = await c.repository.ListPushSubscriptionsByUserID(other.user);
      const before = await snapshot();
      const registering = scoped.UpsertPushSubscription({
        ID: crypto.randomUUID(),
        TeamID: own.team,
        UserID: own.user,
        Endpoint: endpoint,
        P256dh: "fixture-key",
        Auth: "fixture-auth",
        UserAgent: "",
        Platform: "ios_safari_pwa",
        LastSeenAt: now,
        CreatedAt: now,
        UpdatedAt: now,
      });
      if (active) {
        await expect(registering).rejects.toThrow();
        expect(await snapshot()).toEqual(before);
      } else {
        expect(await registering).toMatchObject({
          TeamID: own.team,
          UserID: own.user,
          Endpoint: endpoint,
        });
        expect(await c.db.all(sql`SELECT id FROM push_subscriptions WHERE id=${old}`)).toEqual([]);
      }
      expect(await c.repository.ListPushSubscriptionsByUserID(other.user)).toEqual(foreignBefore);
    } finally {
      await c.query(sql`DELETE FROM push_subscriptions WHERE id=${old}`);
    }
  },
);
