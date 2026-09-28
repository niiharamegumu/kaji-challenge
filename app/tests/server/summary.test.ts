import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDatabase } from "../helpers/d1";
import { provisionUser } from "../../src/server/application/provision-user";
import { monthlySummary, overview } from "../../src/server/application/summary";
import { user } from "../../src/server/infrastructure/auth-schema";
import {
  tasks,
  taskCompletionDaily,
  taskCompletionWeeklyEntries,
} from "../../src/server/infrastructure/schema";

let connection: Awaited<ReturnType<typeof createTestDatabase>>;
let teamId: string;
const now = new Date("2026-09-29T03:00:00.000Z");
const createdAt = "2026-08-01T00:00:00.000Z";

beforeAll(async () => {
  connection = await createTestDatabase();
  for (const id of ["member", "outsider"]) {
    await connection.db.insert(user).values({ id, name: id, email: `${id}@example.com` });
    await provisionUser(connection.repository, id, new Date(createdAt));
  }
  teamId = (await connection.repository.ListMembershipsByUserID("member"))[0].TeamID;
  const otherTeamId = (await connection.repository.ListMembershipsByUserID("outsider"))[0].TeamID;
  await connection.db.insert(tasks).values(
    ["daily-a", "daily-b", "weekly-a", "weekly-b", "other"].map((id) => ({
      id,
      team_id: id === "other" ? otherTeamId : teamId,
      title: id,
      type: id.startsWith("weekly") ? "weekly" : "daily",
      penalty_points: 2,
      required_completions_per_week: id.startsWith("weekly") ? 2 : 1,
      sort_key: 100,
      created_at: createdAt,
      updated_at: createdAt,
    })),
  );
  await connection.db.insert(taskCompletionDaily).values([
    {
      task_id: "daily-a",
      target_date: "2026-09-28",
      completed_by_user_id: "member",
      created_at: createdAt,
    },
    {
      task_id: "daily-b",
      target_date: "2026-09-29",
      completed_by_user_id: null,
      created_at: createdAt,
    },
    {
      task_id: "other",
      target_date: "2026-09-29",
      completed_by_user_id: "outsider",
      created_at: createdAt,
    },
  ]);
  await connection.db.insert(taskCompletionWeeklyEntries).values(
    [
      { id: "w1", task_id: "weekly-a", week_start: "2026-08-31" },
      { id: "w2", task_id: "weekly-a", week_start: "2026-08-31" },
      { id: "w3", task_id: "weekly-b", week_start: "2026-08-31" },
      { id: "w4", task_id: "weekly-a", week_start: "2026-09-07" },
      { id: "w5", task_id: "weekly-a", week_start: "2026-09-28" },
    ].map((entry) => ({ ...entry, completed_by_user_id: "member", created_at: createdAt })),
  );
});

afterAll(async () => {
  await connection?.close();
});

it("keeps overview completions separate by task, period and team, including deleted actors", async () => {
  const result = await overview(connection.repository, teamId, now);
  expect(result.dailyTasks.map((item) => [item.task.id, item.completedToday])).toEqual([
    ["daily-a", false],
    ["daily-b", true],
  ]);
  expect(result.weeklyTasks.map((item) => [item.task.id, item.weekCompletedCount])).toEqual([
    ["weekly-a", 1],
    ["weekly-b", 0],
  ]);
  expect(result.weeklyTasks[0].completionSlots.map((slot) => slot.actor?.userId ?? null)).toEqual([
    "member",
    null,
  ]);
});

it("keeps monthly task/date groups isolated and assigns crossing weeks to their ending month", async () => {
  const result = await monthlySummary(connection.repository, teamId, "2026-09", now);
  const byDate = new Map(result.taskStatusByDate.map((group) => [group.date, group.items]));
  const completed = (date: string, id: string) =>
    byDate.get(date)?.find((item) => item.taskId === id)?.completed;
  expect(completed("2026-09-28", "daily-a")).toBe(true);
  expect(completed("2026-09-28", "daily-b")).toBe(false);
  expect(completed("2026-09-29", "daily-a")).toBe(false);
  expect(completed("2026-09-29", "daily-b")).toBe(true);
  expect(completed("2026-09-01", "weekly-a")).toBe(true);
  expect(completed("2026-09-01", "weekly-b")).toBe(false);
  expect(completed("2026-09-07", "weekly-a")).toBe(false);
  expect(completed("2026-09-28", "weekly-a")).toBeUndefined();
  expect(
    byDate
      .get("2026-09-01")
      ?.find((item) => item.taskId === "weekly-b")
      ?.completionSlots.map((slot) => slot.actor?.userId ?? null),
  ).toEqual(["member", null]);
  expect(
    result.taskStatusByDate.flatMap((group) => group.items).some((item) => item.taskId === "other"),
  ).toBe(false);
});
