import { describe, expect, it } from "vitest";

import { previousMonthKey } from "./month";

describe("previousMonthKey", () => {
  it.each([
    ["2026-08", "2026-07"],
    ["2026-01", "2025-12"],
  ])("returns the previous month for %s", (month, expected) => {
    expect(previousMonthKey(month)).toBe(expected);
  });
});
