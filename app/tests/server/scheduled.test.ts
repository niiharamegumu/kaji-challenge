import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase } from "../helpers/d1";
import { provisionUser } from "../../src/server/application/provision-user";
import { executeOperation } from "../../src/server/application/operations";
import { operationSchema } from "../../src/contracts/operations";
import { crons } from "../../src/server/application/jobs";
import { scheduled } from "../../src/server/transport/scheduled.server";
import type { RuntimeBindings } from "../../src/server/transport/runtime.server";

describe("scheduled entry with D1", () => {
  let connection: Awaited<ReturnType<typeof createTestDatabase>>;
  const userId = crypto.randomUUID();
  let teamId: string;
  // The handler only consumes these bindings for closing jobs.
  const bindings = {
    JOBS_ENABLED: "true",
    MAINTENANCE_MODE: "false",
  } as RuntimeBindings;
  const controller = {
    cron: crons.week,
    scheduledTime: Date.parse("2026-09-06T15:10:00Z"),
    noRetry() {},
  } as ScheduledController;
  beforeAll(async () => {
    connection = await createTestDatabase();
    bindings.DB = connection.binding;
    await connection.query(
      sql`INSERT INTO auth_user(id,name,email) VALUES(${userId},'Scheduled',${userId + "@example.com"})`,
    );
    const now = new Date("2026-08-31T03:00:00Z");
    await provisionUser(connection.repository, userId, now);
    teamId = (await connection.repository.ListMembershipsByUserID(userId))[0].TeamID;
    await executeOperation(
      connection.repository,
      operationSchema.parse({
        operation: "postTask",

        body: { title: "週次", type: "weekly", penaltyPoints: 3, requiredCompletionsPerWeek: 2 },
      }),
      { userId, now, vapidPublicKey: "" },
    );
  });
  afterAll(async () => {
    if (!connection) return;
    if (teamId) await connection.repository.DeleteTeam(teamId);
    await connection.query(sql`DELETE FROM auth_user WHERE id=${userId}`);
    await connection.close();
  });
  it("does not connect or close while disabled or in maintenance", async () => {
    await scheduled(controller, { ...bindings, JOBS_ENABLED: "false" });
    await scheduled(controller, { ...bindings, MAINTENANCE_MODE: "true" });
    expect(
      await connection.repository.GetLatestCloseRunTargetDate({
        TeamID: teamId,
        Scope: "close_week",
      }),
    ).toBe("");
  });
  it("books a month-crossing week in its ending month and retries idempotently", async () => {
    await scheduled(controller, bindings);
    const first = await connection.repository.GetMonthlyPenaltySummary({
      TeamID: teamId,
      MonthStart: "2026-09-01",
    });
    // A missed weekly target incurs one task penalty, not one per missing completion.
    expect(first.WeeklyPenaltyTotal).toBe(3);
    expect(
      await connection.repository.GetLatestCloseRunTargetDate({
        TeamID: teamId,
        Scope: "close_week",
      }),
    ).toBe("2026-08-31");
    await scheduled(controller, bindings);
    expect(
      await connection.repository.GetMonthlyPenaltySummary({
        TeamID: teamId,
        MonthStart: "2026-09-01",
      }),
    ).toEqual(first);
  });
  it("closes pending months oldest first, preserves totals and permits safe replay", async () => {
    const now = new Date("2026-10-05T03:00:00Z");
    async function close(month: string) {
      return executeOperation(
        connection.repository,
        operationSchema.parse({
          operation: "postMonthClose",
          params: { month },
        }),
        { userId, now, vapidPublicKey: "" },
      );
    }
    await expect(close("2026-09")).rejects.toMatchObject({ status: 409 });
    await close("2026-08");
    await close("2026-09");
    const first = await connection.repository.GetMonthlyPenaltySummary({
      TeamID: teamId,
      MonthStart: "2026-09-01",
    });
    expect(first).toMatchObject({ IsClosed: true, WeeklyPenaltyTotal: 12 });
    await close("2026-09");
    expect(
      await connection.repository.GetMonthlyPenaltySummary({
        TeamID: teamId,
        MonthStart: "2026-09-01",
      }),
    ).toEqual(first);
  });
});
