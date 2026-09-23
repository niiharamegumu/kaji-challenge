import { describe, expect, it } from "vitest";
import { formatDateTime } from "./inviteUtils";

describe("invite expiry in Japan", () => {
  it.each([
    ["2026-03-31T15:30:00Z", "2026/04/01 00:30"],
    ["2026-04-01T00:30:00+09:00", "2026/04/01 00:30"],
  ])("displays %s in JST regardless of the device timezone", (input, expected) => {
    expect(formatDateTime(input)).toBe(expected);
  });

  it("handles invalid timestamps", () => {
    expect(formatDateTime("not a date")).toBe("-");
  });
});
