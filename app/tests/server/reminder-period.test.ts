import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDatabase } from "../helpers/d1";
import { reminders, teams } from "../../src/server/infrastructure/schema";
import { reminderOccurrences } from "../../src/server/application/summary";

let connection: Awaited<ReturnType<typeof createTestDatabase>>;
const period = { from: "2026-10-01", to: "2026-10-07", today: "2026-10-03" };
beforeAll(async () => {
  connection = await createTestDatabase();
  await connection.db.insert(teams).values([
    { id: "period-team", name: "period", created_at: "2026-10-01T00:00:00.000Z" },
    { id: "other-team", name: "other", created_at: "2026-10-01T00:00:00.000Z" },
  ]);
  const once = (id: string, date: string, team = "period-team") => ({
    id,
    team_id: team,
    title: id,
    kind: "one_time",
    start_date: date,
  });
  const recurring = (id: string, start: string, end: string | null, schedule = "daily") => ({
    id,
    team_id: "period-team",
    title: id,
    kind: "recurring",
    schedule_type: schedule,
    start_date: start,
    end_date: end,
  });
  const rows = [
    once("past-once", "2026-10-02"),
    once("today-once", period.today),
    once("last-once", period.to),
    once("future-once", "2026-10-08"),
    once("other-team-once", period.today, "other-team"),
    recurring("ended", "2026-09-01", "2026-09-30"),
    recurring("ends-on-first", "2026-09-01", period.from),
    recurring("starts-on-last", period.to, null),
    recurring("future-recurring", "2026-10-08", null),
    recurring("weekly", "2026-09-04", null, "weekly"),
    recurring("monthly", "2026-08-05", null, "monthly"),
  ];
  // D1のパラメーター上限を越えない小さな挿入単位を使う。
  for (const row of rows)
    await connection.db.insert(reminders).values({
      ...row,
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-01T00:00:00.000Z",
    });
  for (let i = 0; i < 40; i++) {
    await connection.db.insert(reminders).values({
      ...once(`expired-${i}`, "2020-01-01"),
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-01T00:00:00.000Z",
    });
  }
});
afterAll(async () => {
  await connection?.close();
});

it("loads only definitions that can occur in the requested period, respecting team and expiry", async () => {
  const all = await connection.repository.ListRemindersByTeamID("period-team");
  const candidates = await connection.repository.ListRemindersByTeamID("period-team", period);
  expect(all).toHaveLength(50);
  expect(candidates.map((row) => row.ID).sort()).toEqual([
    "ends-on-first",
    "last-once",
    "monthly",
    "starts-on-last",
    "today-once",
    "weekly",
  ]);
});

it("preserves inclusive boundaries and recurring occurrences earlier than today", async () => {
  const result = await reminderOccurrences(
    connection.repository,
    "period-team",
    period.from,
    period.to,
    period.today,
  );
  expect(result.map((row) => [row.reminderId, row.date])).toEqual([
    ["ends-on-first", "2026-10-01"],
    ["weekly", "2026-10-02"],
    ["today-once", "2026-10-03"],
    ["monthly", "2026-10-05"],
    ["last-once", "2026-10-07"],
    ["starts-on-last", "2026-10-07"],
  ]);
  const empty = await reminderOccurrences(
    connection.repository,
    "other-team",
    "2026-10-08",
    "2026-10-10",
    period.today,
  );
  expect(empty).toEqual([]);
});
