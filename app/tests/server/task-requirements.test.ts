import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { createTestDatabase } from "../helpers/d1";
import { user } from "../../src/server/infrastructure/auth-schema";
import { tasks, taskWeeklyRequirements } from "../../src/server/infrastructure/schema";
import { provisionUser } from "../../src/server/application/provision-user";
import { executeOperation } from "../../src/server/application/operations";
import { notifyOutstanding } from "../../src/server/application/jobs";
import { operationSchema, responseSchemas } from "../../src/contracts/operations";

let c: Awaited<ReturnType<typeof createTestDatabase>>;
const created = "2026-09-23T03:00:00.000Z";
const sunday = "2026-09-27T14:59:59.999Z";
const monday = "2026-09-27T15:00:00.000Z";
beforeAll(async () => {
  c = await createTestDatabase();
});
afterAll(async () => {
  await c?.close();
});

async function fixture(required: number, type = "weekly") {
  const userId = crypto.randomUUID();
  await c.db.insert(user).values({ id: userId, name: "Tester", email: `${userId}@example.com` });
  await provisionUser(c.repository, userId, new Date(created));
  const teamId = (await c.repository.ListMembershipsByUserID(userId))[0].TeamID;
  const run = async (operation: string, now: string, body?: unknown, params = {}) => {
    const input = operationSchema.parse({ operation, body, params });
    const result = await executeOperation(c.repository, input, {
      userId,
      now: new Date(now),
      vapidPublicKey: "",
    });
    return responseSchemas[input.operation].parse(result.data);
  };
  const task = responseSchemas.postTask.parse(
    await run("postTask", created, {
      title: "Weekly",
      type,
      penaltyPoints: 4,
      requiredCompletionsPerWeek: required,
    }),
  );
  const edit = (count: number, now = sunday) =>
    run("patchTask", now, { requiredCompletionsPerWeek: count }, { taskId: task.id });
  const complete = (targetDate: string, action = "increment", now = "2026-10-06T03:00:00.000Z") =>
    run("postTaskCompletion", now, { targetDate, action }, { taskId: task.id });
  const overview = async (now: string) =>
    responseSchemas.getTaskOverview.parse(await run("getTaskOverview", now));
  const summary = async (month: string) =>
    responseSchemas.getPenaltySummaryMonthly.parse(
      await run("getPenaltySummaryMonthly", "2026-10-06T03:00:00.000Z", undefined, { month }),
    );
  return { task, userId, teamId, run, edit, complete, overview, summary };
}

it.each([
  [3, 1],
  [1, 3],
  [2, 7],
  [7, 2],
])("preserves old weeks and switches %i to %i on Monday JST", async (before, after) => {
  const f = await fixture(before);
  for (let i = 0; i < before; i++) await f.complete("2026-09-23", "increment", sunday);
  await f.run("postMonthClose", "2026-10-06T03:00:00.000Z", undefined, { month: "2026-09" });
  const oldSummary = await f.summary("2026-09");
  expect(oldSummary.weeklyPenaltyTotal).toBe(0);
  const updated = responseSchemas.patchTask.parse(await f.edit(after));
  expect(updated).toMatchObject({
    id: f.task.id,
    requiredCompletionsPerWeek: before,
    scheduledWeeklyRequirement: { effectiveWeek: "2026-09-28", requiredCompletionsPerWeek: after },
  });
  const current = (await f.overview(sunday)).weeklyTasks[0];
  expect(current.weekCompletedCount).toBe(before);
  expect(current.completionSlots).toHaveLength(before);
  expect(current.completionSlots.every((slot) => slot.actor?.userId === f.userId)).toBe(true);
  const next = (await f.overview(monday)).weeklyTasks[0];
  expect(next).toMatchObject({ weekCompletedCount: 0, requiredCompletionsPerWeek: after });
  expect(next.task.scheduledWeeklyRequirement).toBeUndefined();
  expect(next.completionSlots).toHaveLength(after);
  // Concurrent operations use the new cap, even after crossing a month boundary.
  await Promise.all(Array.from({ length: 9 }, () => f.complete("2026-10-01")));
  const october = await f.summary("2026-10");
  const crossing = october.taskStatusByDate.find((group) => group.date === "2026-10-01")!.items[0];
  expect(crossing.completed).toBe(true);
  expect(crossing.completionSlots).toHaveLength(after);
  expect((await f.overview("2026-10-01T03:00:00.000Z")).weeklyTasks[0].weekCompletedCount).toBe(
    after,
  );
  await c.repository.ClosePeriod(f.teamId, "week", "2026-09-28");
  expect((await f.summary("2026-10")).weeklyPenaltyTotal).toBe(0);
  await f.complete("2026-10-01", "decrement");
  expect((await f.summary("2026-10")).weeklyPenaltyTotal).toBe(4);
  await f.complete("2026-10-01");
  expect((await f.summary("2026-10")).weeklyPenaltyTotal).toBe(0);
  expect(await f.summary("2026-09")).toEqual(oldSummary);
  // Editing old completions must still use the old target and recalculate closed totals.
  await f.complete("2026-09-23", "decrement");
  expect((await f.summary("2026-09")).weeklyPenaltyTotal).toBe(4);
  await f.complete("2026-09-23");
  expect(await f.summary("2026-09")).toEqual(oldSummary);
  if (before === 1)
    expect(await f.complete("2026-09-23", "complete")).toMatchObject({ completed: true });
  else
    await expect(f.complete("2026-09-23", "complete")).rejects.toThrow(
      "invalid weekly completion action",
    );
  if (after === 1) {
    expect(await f.complete("2026-10-01", "incomplete")).toMatchObject({
      completed: false,
      weeklyCompletedCount: 0,
    });
    expect(await f.complete("2026-10-01", "complete")).toMatchObject({
      completed: true,
      weeklyCompletedCount: 1,
    });
  } else
    await expect(f.complete("2026-10-01", "complete")).rejects.toThrow(
      "invalid weekly completion action",
    );
  expect((await c.repository.GetTaskByID(f.task.id)).RequiredCompletionsPerWeek).toBe(before);
});

it("replaces and cancels next week's plan while retaining earlier requirements", async () => {
  const f = await fixture(3);
  await f.edit(7);
  await f.edit(2);
  await f.run("patchTask", sunday, { notes: "Kept" }, { taskId: f.task.id });
  expect(
    (await f.overview(sunday)).weeklyTasks[0].task.scheduledWeeklyRequirement
      ?.requiredCompletionsPerWeek,
  ).toBe(2);
  await f.edit(3);
  expect((await f.overview(sunday)).weeklyTasks[0].task.scheduledWeeklyRequirement).toBeUndefined();
  await Promise.all([f.edit(1), f.edit(2)]);
  expect(
    await c.db
      .select()
      .from(taskWeeklyRequirements)
      .where(eq(taskWeeklyRequirements.task_id, f.task.id)),
  ).toHaveLength(1);
  await f.edit(1);
  await f.edit(7, monday);
  expect((await f.overview(monday)).weeklyTasks[0].task).toMatchObject({
    requiredCompletionsPerWeek: 1,
    scheduledWeeklyRequirement: { effectiveWeek: "2026-10-05", requiredCompletionsPerWeek: 7 },
  });
  expect(
    (await f.overview("2026-10-04T15:00:00.000Z")).weeklyTasks[0].requiredCompletionsPerWeek,
  ).toBe(7);
  expect((await c.repository.GetTaskByID(f.task.id)).WeeklyRequirements).toHaveLength(2);
});

it("rolls back task edits when the requirement insert fails and rejects deleted or foreign tasks", async () => {
  const f = await fixture(3);
  const before = await c.repository.GetTaskByID(f.task.id);
  const scoped = c.repository.forMember(f.teamId, f.userId);
  await expect(
    scoped.UpdateTask({
      ID: f.task.id,
      Title: "Must rollback",
      RequiredCompletionsPerWeek: 8,
      UpdatedAt: sunday,
    }),
  ).rejects.toThrow();
  expect(await c.repository.GetTaskByID(f.task.id)).toEqual(before);
  const other = await fixture(1);
  await expect(
    scoped.UpdateTask({ ID: other.task.id, RequiredCompletionsPerWeek: 2, UpdatedAt: sunday }),
  ).rejects.toThrow();
  await c.db.update(tasks).set({ deleted_at: sunday }).where(eq(tasks.id, f.task.id));
  await expect(
    scoped.UpdateTask({ ID: f.task.id, RequiredCompletionsPerWeek: 2, UpdatedAt: sunday }),
  ).rejects.toThrow();
  expect(
    await c.db
      .select()
      .from(taskWeeklyRequirements)
      .where(eq(taskWeeklyRequirements.task_id, f.task.id)),
  ).toEqual([]);
});

it("keeps daily tasks at one completion and validates weekly request limits", async () => {
  const f = await fixture(1, "daily");
  const updated = responseSchemas.patchTask.parse(await f.edit(7));
  expect(updated.requiredCompletionsPerWeek).toBe(1);
  expect(updated.scheduledWeeklyRequirement).toBeUndefined();
  expect((await c.repository.GetTaskByID(f.task.id)).WeeklyRequirements).toEqual([]);
  for (const count of [0, 8, 1.5, "2", null]) {
    expect(
      operationSchema.safeParse({
        operation: "patchTask",
        params: { taskId: f.task.id },
        body: { requiredCompletionsPerWeek: count },
      }).success,
    ).toBe(false);
  }
});

it("uses the active week's target for notification remaining counts", async () => {
  const f = await fixture(3);
  await f.edit(7);
  await c.query(sql`INSERT INTO push_subscriptions
    (id,team_id,user_id,endpoint,p256dh,auth,user_agent,platform,is_active,last_seen_at,created_at,updated_at)
    VALUES (${crypto.randomUUID()},${f.teamId},${f.userId},${"https://push.example/" + f.task.id},'key','auth','','ios_safari_pwa',1,${created},${created},${created})`);
  const send = vi.fn().mockResolvedValue("sent");
  const delivery = { claim: async () => "claim", send, finish: async () => {} };
  await notifyOutstanding(c.repository, delivery, "weekly_due_sun_1000", new Date(sunday));
  expect(send.mock.calls[0][1].body).toContain("あと3回");
  send.mockClear();
  await notifyOutstanding(
    c.repository,
    delivery,
    "weekly_due_sun_1000",
    new Date("2026-10-04T01:00:00.000Z"),
  );
  expect(send.mock.calls[0][1].body).toContain("あと7回");
});

it("adds history storage without rewriting existing tasks or completion records", async () => {
  const old = await createTestDatabase(undefined, "0008_mcp_connections.sql");
  try {
    await old.db.insert(user).values({ id: "legacy", name: "Legacy", email: "legacy@example.com" });
    await provisionUser(old.repository, "legacy", new Date(created));
    const teamId = (await old.repository.ListMembershipsByUserID("legacy"))[0].TeamID;
    await old.repository.CreateTask({
      ID: "legacy-task",
      TeamID: teamId,
      Title: "Legacy",
      Notes: "Note",
      Type: "weekly",
      PenaltyPoints: 4,
      AssigneeUserID: "legacy",
      RequiredCompletionsPerWeek: 3,
      SortKey: 100,
      CreatedAt: created,
      UpdatedAt: created,
    });
    await old.query(
      sql`INSERT INTO task_completion_weekly_entries VALUES ('legacy-completion','legacy-task','2026-09-21','legacy',${created})`,
    );
    const beforeTasks = await old.db.select().from(tasks);
    const beforeCompletions = await old.query(sql`SELECT * FROM task_completion_weekly_entries`);
    const migration = await readFile(
      new URL("../../migrations/0009_task_weekly_requirements.sql", import.meta.url),
      "utf8",
    );
    await old.db.run(sql.raw(migration));
    expect(await old.db.select().from(tasks)).toEqual(beforeTasks);
    expect(await old.query(sql`SELECT * FROM task_completion_weekly_entries`)).toEqual(
      beforeCompletions,
    );
    const task = await old.repository.GetTaskByID("legacy-task");
    expect(task).toMatchObject({ RequiredCompletionsPerWeek: 3, WeeklyRequirements: [] });
    expect(await old.db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
  } finally {
    await old.close();
  }
});
