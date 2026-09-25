import { eq, sql } from "drizzle-orm";
import { teams, tasks } from "../../src/server/infrastructure/schema";
import { user } from "../../src/server/infrastructure/auth-schema";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDatabase } from "../helpers/d1";
import { provisionUser } from "../../src/server/application/provision-user";
import { executeOperation } from "../../src/server/application/operations";
import { operationSchema, responseSchemas } from "../../src/contracts/operations";
let connection: Awaited<ReturnType<typeof createTestDatabase>>;
const userId = crypto.randomUUID(),
  now = new Date("2026-09-25T00:00:00Z");
let teamId: string, weeklyId: string, dailyId: string;
const run = async (operation: string, body?: unknown, params = {}) =>
  executeOperation(connection.repository, operationSchema.parse({ operation, body, params }), {
    userId,
    now,
    vapidPublicKey: "",
  });
beforeAll(async () => {
  connection = await createTestDatabase();
  await connection.db
    .insert(user)
    .values({ id: userId, name: "Atomic", email: "atomic@example.com" });
  await Promise.all(
    Array.from({ length: 5 }, () => provisionUser(connection.repository, userId, now)),
  );
  teamId = (await connection.repository.ListMembershipsByUserID(userId))[0].TeamID;
  weeklyId = responseSchemas.postTask.parse(
    (
      await run("postTask", {
        title: "Weekly",
        type: "weekly",
        penaltyPoints: 3,
        requiredCompletionsPerWeek: 3,
      })
    ).data,
  ).id;
  dailyId = responseSchemas.postTask.parse(
    (await run("postTask", { title: "Daily", type: "daily", penaltyPoints: 1 })).data,
  ).id;
});
afterAll(async () => {
  await connection?.close();
});
it("provisions exactly one team under concurrent login", async () => {
  expect(await connection.db.select().from(teams)).toHaveLength(1);
  expect(await connection.repository.ListMembershipsByUserID(userId)).toHaveLength(1);
});
it("rolls back a real Drizzle batch when a later statement fails", async () => {
  const row = { id: "duplicate", name: "Initial", created_at: now.toISOString() };
  await expect(
    connection.db.batch([
      connection.db.insert(teams).values(row),
      connection.db.insert(teams).values(row),
    ]),
  ).rejects.toThrow();
  expect(await connection.db.select().from(teams).where(eq(teams.id, row.id))).toEqual([]);
});
it("applies simultaneous increments up to capacity and decrements down to zero", async () => {
  await Promise.all(
    Array.from({ length: 8 }, () =>
      run(
        "postTaskCompletion",
        { targetDate: "2026-09-25", action: "increment" },
        { taskId: weeklyId },
      ),
    ),
  );
  expect(
    await connection.repository.GetTaskCompletionWeeklyEntryCount({
      TaskID: weeklyId,
      WeekStart: "2026-09-21",
    }),
  ).toBe(3);
  await Promise.all(
    Array.from({ length: 8 }, () =>
      run(
        "postTaskCompletion",
        { targetDate: "2026-09-25", action: "decrement" },
        { taskId: weeklyId },
      ),
    ),
  );
  expect(
    await connection.repository.GetTaskCompletionWeeklyEntryCount({
      TaskID: weeklyId,
      WeekStart: "2026-09-21",
    }),
  ).toBe(0);
});
it("simultaneous complete requests never toggle a daily task back", async () => {
  await Promise.all(
    Array.from({ length: 3 }, () =>
      run(
        "postTaskCompletion",
        { targetDate: "2026-09-25", action: "complete" },
        { taskId: dailyId },
      ),
    ),
  );
  expect(
    await connection.repository.HasTaskCompletionDaily({
      TaskID: dailyId,
      TargetDate: "2026-09-25",
    }),
  ).toBe(true);
  await run(
    "postTaskCompletion",
    { targetDate: "2026-09-25", action: "incomplete" },
    { taskId: dailyId },
  );
  expect(
    await connection.repository.HasTaskCompletionDaily({
      TaskID: dailyId,
      TargetDate: "2026-09-25",
    }),
  ).toBe(false);
});
it("updates only submitted task fields during concurrent edits", async () => {
  await Promise.all([
    run("patchTask", { title: "Changed" }, { taskId: dailyId }),
    run("patchTask", { notes: "Note" }, { taskId: dailyId }),
  ]);
  expect(await connection.repository.GetTaskByID(dailyId)).toMatchObject({
    Title: "Changed",
    Notes: "Note",
  });
});
it("recalculates simultaneous closes without double-counting", async () => {
  await connection.db.update(tasks).set({ created_at: "2026-09-01T00:00:00Z" });
  await Promise.all(
    Array.from({ length: 3 }, () => connection.repository.ClosePeriod(teamId, "day", "2026-09-24")),
  );
  expect(
    await connection.repository.GetMonthlyPenaltySummary({
      TeamID: teamId,
      MonthStart: "2026-09-01",
    }),
  ).toMatchObject({ DailyPenaltyTotal: 1 });
  expect(await connection.db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
});
it("keeps SQL-looking values as data", async () => {
  const name = "O'Reilly ? ); DROP TABLE teams; --";
  await run("patchTeamCurrent", { name });
  expect((await connection.repository.ListMembershipsByUserID(userId))[0].TeamName).toBe(name);
});

it("rolls back a completion when recalculating the same batch fails", async () => {
  await connection.db.run(
    sql`CREATE TRIGGER reject_summary BEFORE UPDATE ON monthly_penalty_summaries BEGIN SELECT RAISE(ABORT,'fixture'); END`,
  );
  try {
    await expect(
      run(
        "postTaskCompletion",
        { targetDate: "2026-09-24", action: "complete" },
        { taskId: dailyId },
      ),
    ).rejects.toThrow();
    expect(
      await connection.repository.HasTaskCompletionDaily({
        TaskID: dailyId,
        TargetDate: "2026-09-24",
      }),
    ).toBe(false);
  } finally {
    await connection.db.run(sql`DROP TRIGGER reject_summary`);
  }
});
it("does not shift sort positions when task creation fails", async () => {
  const before = await connection.repository.ListTasksByTeamID(teamId);
  await expect(
    connection.repository.forMember(teamId, userId).CreateTask({
      ID: dailyId,
      TeamID: teamId,
      Title: "Duplicate",
      Notes: null,
      Type: "daily",
      PenaltyPoints: 1,
      AssigneeUserID: "",
      RequiredCompletionsPerWeek: 1,
      SortKey: 100,
      CreatedAt: now.toISOString(),
      UpdatedAt: now.toISOString(),
    }),
  ).rejects.toThrow();
  expect(await connection.repository.ListTasksByTeamID(teamId)).toEqual(before);
});
it("does not partially reorder a list that gained an item after it was read", async () => {
  const before = await connection.repository.ListTasksByTeamID(teamId);
  await expect(
    connection.repository.forMember(teamId, userId).Reorder({
      teamId,
      kind: "tasks",
      type: "daily",
      ids: ["removed-id"],
      now: now.toISOString(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await connection.repository.ListTasksByTeamID(teamId)).toEqual(before);
});
it("allows only one concurrent move and preserves ownership and foreign keys", async () => {
  const mover = crypto.randomUUID();
  await connection.db
    .insert(user)
    .values({ id: mover, name: "Mover", email: mover + "@example.com" });
  await provisionUser(connection.repository, mover, now);
  const from = (await connection.repository.ListMembershipsByUserID(mover))[0].TeamID;
  const outcomes = await Promise.allSettled(
    ["Left", "Right"].map((name) =>
      connection.repository.MoveMember({
        userId: mover,
        fromTeamId: from,
        toTeamId: crypto.randomUUID(),
        newTeamName: name,
        now: now.toISOString(),
      }),
    ),
  );
  expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect((await connection.repository.ListMembershipsByUserID(mover))[0].Role).toBe("owner");
  expect(await connection.db.select().from(teams).where(eq(teams.id, from))).toEqual([]);
  expect(await connection.db.select().from(teams)).toHaveLength(2);
  expect(await connection.db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
});
it("does not recalculate an already closed month during a repeated close", async () => {
  await connection.repository.RecalculateMonth({
    teamId,
    month: "2026-09",
    ensureCoverage: true,
    closeMonth: true,
  });
  const saved = await connection.repository.GetMonthlyPenaltySummary({
    TeamID: teamId,
    MonthStart: "2026-09-01",
  });
  await connection.db.update(tasks).set({ penalty_points: 50 }).where(eq(tasks.id, dailyId));
  await Promise.all([
    connection.repository.RecalculateMonth({
      teamId,
      month: "2026-09",
      ensureCoverage: true,
      closeMonth: true,
    }),
    connection.repository.RecalculateMonth({
      teamId,
      month: "2026-09",
      ensureCoverage: true,
      closeMonth: true,
    }),
  ]);
  expect(
    await connection.repository.GetMonthlyPenaltySummary({
      TeamID: teamId,
      MonthStart: "2026-09-01",
    }),
  ).toEqual(saved);
});
it("keeps reads free of reminder deletion and summary creation", async () => {
  const id = crypto.randomUUID();
  await connection.repository.CreateReminder({
    ID: id,
    TeamID: teamId,
    Title: "Expired",
    Notes: null,
    Kind: "one_time",
    ScheduleType: null,
    StartDate: "2026-09-01",
    EndDate: null,
    CreatedAt: now.toISOString(),
    UpdatedAt: now.toISOString(),
  });
  const definitions = responseSchemas.listReminderDefinitions.parse(
    (await run("listReminderDefinitions")).data,
  );
  expect(definitions.items.some((item) => item.id === id)).toBe(false);
  const calendar = responseSchemas.listReminders.parse(
    (await run("listReminders", undefined, { from: "2026-09-01", to: "2026-09-30" })).data,
  );
  expect(calendar.days.flatMap((day) => day.items).some((item) => item.reminderId === id)).toBe(
    false,
  );
  expect(await connection.repository.GetReminderByID(id)).toMatchObject({ Title: "Expired" });
  await run("getPenaltySummaryMonthly", undefined, { month: "2026-12" });
  await expect(
    connection.repository.GetMonthlyPenaltySummary({ TeamID: teamId, MonthStart: "2026-12-01" }),
  ).rejects.toMatchObject({ status: 404 });
});
