import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDatabase } from "../helpers/d1";
import { user } from "../../src/server/infrastructure/auth-schema";
import { D1Repository } from "../../src/server/infrastructure/repository";
import { provisionUser } from "../../src/server/application/provision-user";
import { executeOperation } from "../../src/server/application/operations";
import { operationSchema, responseSchemas } from "../../src/contracts/operations";

let connection: Awaited<ReturnType<typeof createTestDatabase>>;
const userId = crypto.randomUUID();

let taskId: string;
const initialTime = new Date("2026-09-23T03:00:00.000Z");
async function run(operation: string, now: Date, body?: unknown, params = {}) {
  const input = operationSchema.parse({ operation, body, params });
  // Every request constructs a fresh repository, as the Worker does.
  const result = await executeOperation(new D1Repository(connection.db), input, {
    userId,
    now,
    vapidPublicKey: "",
  });
  return responseSchemas[input.operation].parse(result.data);
}
beforeAll(async () => {
  connection = await createTestDatabase();
  await connection.db
    .insert(user)
    .values({ id: userId, name: "Weekly tester", email: "weekly@example.com" });
  await provisionUser(connection.repository, userId, initialTime);
  await run("getMe", initialTime);
  const task = responseSchemas.postTask.parse(
    await run("postTask", initialTime, {
      title: "Weekly",
      type: "weekly",
      penaltyPoints: 1,
      requiredCompletionsPerWeek: 3,
    }),
  );
  taskId = task.id;
  for (let i = 0; i < 3; i++)
    await run(
      "postTaskCompletion",
      new Date(initialTime.getTime() + i * 1000),
      { targetDate: "2026-09-23", action: "increment" },
      { taskId },
    );
});
afterAll(async () => {
  await connection?.close();
});

it.each([
  "2026-09-23T03:01:00.000Z",
  "2026-09-23T10:00:00.000Z",
  "2026-09-24T01:00:00.000Z",
  "2026-09-27T14:59:59.999Z",
])("keeps overview and summary completed after time passes: %s", async (instant) => {
  const now = new Date(instant);
  const overview = responseSchemas.getTaskOverview.parse(await run("getTaskOverview", now));
  const weekly = overview.weeklyTasks.find((item) => item.task.id === taskId)!;
  expect(weekly.weekCompletedCount).toBe(3);
  expect(weekly.completionSlots).toEqual(
    [1, 2, 3].map((slot) => ({
      slot,
      actor: { userId, effectiveName: "Weekly tester", colorHex: null },
    })),
  );
  const summary = responseSchemas.getPenaltySummaryMonthly.parse(
    await run("getPenaltySummaryMonthly", now, undefined, { month: "2026-09" }),
  );
  const items = summary.taskStatusByDate
    .flatMap((group) => group.items)
    .filter((item) => item.taskId === taskId);
  expect(
    items.some(
      (item) =>
        item.completed && item.completionSlots.every((slot) => slot.actor?.userId === userId),
    ),
  ).toBe(true);
  const again = responseSchemas.getTaskOverview.parse(await run("getTaskOverview", now));
  expect(again.weeklyTasks.find((item) => item.task.id === taskId)).toEqual(weekly);
});
it("starts a new week at Monday JST without deleting the previous week's history", async () => {
  const now = new Date("2026-09-27T15:00:00.000Z");
  const overview = responseSchemas.getTaskOverview.parse(await run("getTaskOverview", now));
  expect(overview.weeklyTasks.find((item) => item.task.id === taskId)).toMatchObject({
    weekCompletedCount: 0,
  });
  expect(
    await connection.repository.GetTaskCompletionWeeklyEntryCount({
      TaskID: taskId,
      WeekStart: "2026-09-21",
    }),
  ).toBe(3);
});
