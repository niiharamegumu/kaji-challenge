import { describe, expect, it } from "vitest";
import {
  endOfWeekDateKey,
  formatDateKey,
  formatDateLabel,
  monthEndDateKey,
  parseDateKey,
  todayDateKey,
} from "./date";

describe("Japanese calendar dates", () => {
  it.each([
    ["2026-03-31T14:59:59Z", "2026-03-31"],
    ["2026-03-31T15:00:00Z", "2026-04-01"],
    ["2026-12-31T15:00:00Z", "2027-01-01"],
  ])("uses the JST date for %s", (instant, expected) => {
    expect(todayDateKey(new Date(instant))).toBe(expected);
  });

  it("preserves date-only keys when formatting labels and FullCalendar cells", () => {
    expect(formatDateLabel("2026-04-02")).toBe("4月2日(木)");
    expect(formatDateKey(new Date("2026-04-02T00:00:00Z"))).toBe("2026-04-02");
    expect(formatDateKey(parseDateKey("2026-04-02"))).toBe("2026-04-02");
  });

  it("calculates month and week boundaries without local daylight-saving shifts", () => {
    expect(monthEndDateKey("2024-02")).toBe("2024-02-29");
    expect(monthEndDateKey("2026-02")).toBe("2026-02-28");
    expect(endOfWeekDateKey("2026-03-07")).toBe("2026-03-08");
    expect(endOfWeekDateKey("2026-04-01")).toBe("2026-04-05");
    expect(endOfWeekDateKey("2026-04-05")).toBe("2026-04-05");
  });
});
