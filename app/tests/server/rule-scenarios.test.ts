import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  completionCount,
  occurrenceDates,
  type CompletionAction,
} from "../../src/server/domain/rules";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/domain-scenarios.json", import.meta.url), "utf8"),
) as {
  completions: {
    type: "daily" | "weekly";
    current: number;
    required: number;
    action: CompletionAction;
    target: string;
    today: string;
    count?: number;
    error?: boolean;
  }[];
  reminders: {
    kind: string;
    scheduleType?: string;
    startDate: string;
    endDate?: string;
    from: string;
    to: string;
    dates: string[];
  }[];
};
describe("completion and reminder scenarios", () => {
  it.each(fixture.completions)("completion $type $action $target", (c) => {
    const execute = () =>
      completionCount(c.type, c.current, c.required, c.action, c.target, c.today);
    if (c.error) expect(execute).toThrow();
    else expect(execute()).toBe(c.count);
  });
  it.each(fixture.reminders)("reminder $kind $scheduleType $startDate", (c) => {
    expect(occurrenceDates(c, c.from, c.to)).toEqual(c.dates);
  });
});
