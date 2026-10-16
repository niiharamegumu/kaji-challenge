import { describe, expect, it } from "vitest";
import { addDays, nextMonth, todayJST, weekStart, isDate } from "../../src/server/domain/dates";
import { completionCount, occurrenceDates, validateReorder } from "../../src/server/domain/rules";
import {
  operationSchema,
  MonthCloseCandidateResponseSchema,
  TaskCompletionSlotSchema,
  TaskOverviewDailyTaskSchema,
} from "../../src/contracts/operations";
import { crons, pushMessage } from "../../src/server/application/jobs";
describe("date and task rules", () => {
  it.each([
    ["2028-01-01", "2028-12-31", true],
    ["2026-10-16", "2026-10-16", true],
    ["2028-01-01", "2029-01-01", false],
    ["2026-10-17", "2026-10-16", false],
    ["0001-01-01", "9999-12-31", false],
    ["2026-02-30", "2026-03-01", false],
  ])("bounds reminder expansion from %s to %s (valid: %s)", (from, to, valid) => {
    expect(
      operationSchema.safeParse({ operation: "listReminders", params: { from, to } }).success,
    ).toBe(valid);
  });

  it("accepts the UI's null representation for uncompleted slots", () => {
    expect(TaskCompletionSlotSchema.parse({ slot: 1, actor: null })).toEqual({
      slot: 1,
      actor: null,
    });
    expect(TaskOverviewDailyTaskSchema.shape.completedBy.parse(null)).toBeNull();
  });
  it("uses midnight JST and Monday weeks across months", () => {
    expect(todayJST(new Date("2026-08-31T14:59:59Z"))).toBe("2026-08-31");
    expect(todayJST(new Date("2026-08-31T15:00:00Z"))).toBe("2026-09-01");
    expect(weekStart("2026-09-01")).toBe("2026-08-31");
    expect(addDays(weekStart("2026-09-01"), 6)).toBe("2026-09-06");
    expect(isDate("2026-02-29")).toBe(false);
  });
  it("rejects future and invalid historical completion actions", () => {
    expect(() => completionCount("daily", 0, 1, "increment", "2026-09-13", "2026-09-14")).toThrow();
    expect(() => completionCount("daily", 0, 1, "complete", "2026-09-15", "2026-09-14")).toThrow();
    expect(completionCount("daily", 0, 1, "complete", "2026-09-13", "2026-09-14")).toBe(1);
    expect(completionCount("weekly", 3, 3, "increment", "2026-09-14", "2026-09-14")).toBe(3);
    expect(completionCount("weekly", 1, 1, "incomplete", "2026-09-14", "2026-09-14")).toBe(0);
  });
  it("skips missing month dates and respects recurrence end", () => {
    expect(
      occurrenceDates(
        {
          kind: "recurring",
          scheduleType: "monthly",
          startDate: "2026-01-31",
          endDate: "2026-04-30",
        },
        "2026-01-01",
        "2026-05-31",
      ),
    ).toEqual(["2026-01-31", "2026-03-31"]);
  });
  it("does not advance beyond the supported date format after the last occurrence", () => {
    expect(
      occurrenceDates(
        { kind: "recurring", scheduleType: "daily", startDate: "9999-12-30" },
        "9999-12-30",
        "9999-12-31",
      ),
    ).toEqual(["9999-12-30", "9999-12-31"]);
  });
  it("rejects date arithmetic outside four-digit years instead of returning repeating dates", () => {
    expect(isDate("0000-01-01")).toBe(false);
    expect(isDate("0001-01-01")).toBe(true);
    expect(isDate("9999-12-31")).toBe(true);
    for (const operation of [
      () => weekStart("0000-01-01"),
      () => addDays("0001-01-01", -1),
      () => addDays("9999-12-31", 1),
      () => nextMonth("0000-01"),
      () => nextMonth("9999-12"),
    ])
      expect(operation).toThrow("date must use a year from 0001 through 9999");
  });
  it("accepts reordered IDs and rejects missing, duplicate, or foreign IDs", () => {
    const current = ["a", "b", "c"];
    expect(() => validateReorder(current, ["c", "a", "b"])).not.toThrow();
    for (const ids of [
      ["a", "b"],
      ["a", "b", "b"],
      ["a", "b", "x"],
    ]) {
      expect(() => validateReorder(current, ids)).toThrow();
    }
  });
  it("validates real months", () => {
    expect(
      operationSchema.safeParse({ operation: "postMonthClose", params: { month: "2026-13" } })
        .success,
    ).toBe(false);
    expect(
      MonthCloseCandidateResponseSchema.parse({
        candidate: {
          month: "2026-08",
          dailyThroughDate: "2026-08-31",
          weeklyThroughDate: "2026-08-30",
        },
        pendingMonthCount: 1,
      }).candidate?.month,
    ).toBe("2026-08");
  });
  it.each(["getPenaltySummaryMonthly", "postMonthClose"])(
    "%s rejects months whose calculation crosses the supported year bounds",
    (operation) => {
      for (const month of ["0000-01", "0000-12", "9999-12"]) {
        expect(operationSchema.safeParse({ operation, params: { month } }).success).toBe(false);
      }
      for (const month of ["0001-01", "2026-10", "9999-11"]) {
        expect(operationSchema.safeParse({ operation, params: { month } }).success).toBe(true);
      }
    },
  );
  it("keeps the existing notification copy and JST schedule", () => {
    expect(pushMessage("weekly_prev_sat_1900", [{ title: "洗濯", remaining: 2 }])).toEqual({
      title: "今週の未完了が1件あります",
      body: "週間タスク\n洗濯（あと2回）",
    });
    expect(crons).toEqual({
      day: "5 15 * * *",
      week: "10 15 * * SUN",
      daily_2100: "0 12 * * *",
      weekly_prev_sat_1900: "0 10 * * SAT",
      weekly_due_sun_1000: "0 1 * * SUN",
    });
  });
});
