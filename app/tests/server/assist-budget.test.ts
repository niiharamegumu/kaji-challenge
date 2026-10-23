import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase } from "../helpers/d1";
import { createAssistBudget } from "../../src/server/infrastructure/assist-budget";

let connection: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  connection = await createTestDatabase();
});
afterAll(async () => {
  await connection?.close();
});
beforeEach(async () => {
  await connection.query(sql`INSERT OR REPLACE INTO assist_usage VALUES ('voice',0,0,'',0,0)`);
});
it("reserves at most 12 turns for concurrent requests across fresh budget instances", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () => createAssistBudget(connection.db).reserve()),
  );
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(12);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(8);
  expect(
    (await connection.query(sql`SELECT window_count,daily_count,total_count FROM assist_usage`))
      .rows,
  ).toEqual([{ window_count: 12, daily_count: 12, total_count: 12 }]);
});
it("opens a new 60-second window without clearing daily or total use", async () => {
  await connection.query(
    sql`UPDATE assist_usage SET window_start=unixepoch()-60,window_count=12,usage_day=date('now'),daily_count=12,total_count=20`,
  );
  await createAssistBudget(connection.db).reserve();
  expect(
    (await connection.query(sql`SELECT window_count,daily_count,total_count FROM assist_usage`))
      .rows[0],
  ).toEqual({ window_count: 1, daily_count: 13, total_count: 21 });
});
it("stops at the daily limit even when the minute window has expired", async () => {
  await connection.query(
    sql`UPDATE assist_usage SET usage_day=date('now'),daily_count=49,total_count=100`,
  );
  await createAssistBudget(connection.db).reserve();
  await expect(createAssistBudget(connection.db).reserve()).rejects.toMatchObject({
    status: 429,
    code: "assist_usage_limit",
  });
  expect(
    (await connection.query(sql`SELECT daily_count,total_count FROM assist_usage`)).rows[0],
  ).toEqual({ daily_count: 50, total_count: 101 });
});
it("resets only daily use on UTC rollover; cumulative trial never resets", async () => {
  await connection.query(
    sql`UPDATE assist_usage SET usage_day=date('now','-1 day'),daily_count=50,total_count=499`,
  );
  await createAssistBudget(connection.db).reserve();
  expect(
    (await connection.query(sql`SELECT daily_count,total_count FROM assist_usage`)).rows[0],
  ).toEqual({ daily_count: 1, total_count: 500 });
  await connection.query(
    sql`UPDATE assist_usage SET usage_day=date('now','-1 day'),window_start=0`,
  );
  await expect(createAssistBudget(connection.db).reserve()).rejects.toMatchObject({ status: 429 });
});
it("fails closed if the quota row is missing rather than resetting the trial", async () => {
  await connection.query(sql`DELETE FROM assist_usage`);
  await expect(createAssistBudget(connection.db).reserve()).rejects.toMatchObject({ status: 429 });
  expect((await connection.query(sql`SELECT * FROM assist_usage`)).rows).toEqual([]);
});
