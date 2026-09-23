import { addDays, midnightJST, weekStart, weekday } from "./dates";
import { invariant } from "./errors";

export function effectiveName(displayName: string, nickname?: string | null) {
  return nickname?.trim() || displayName.trim() || "User";
}
export function ownTeamName(name: string) {
  return Array.from(`${name.trim() || "My Team"} Team`)
    .slice(0, 50)
    .join("");
}
export function effectiveAt(
  task: { createdAt: string; deletedAt?: string | null },
  cutoff: string,
) {
  const end = midnightJST(cutoff);
  return task.createdAt < end && (!task.deletedAt || task.deletedAt >= end);
}
export type CompletionAction = "toggle" | "complete" | "increment" | "decrement";
export function completionCount(
  type: "daily" | "weekly",
  current: number,
  required: number,
  action: CompletionAction,
  target: string,
  today: string,
) {
  if (type === "daily") {
    invariant(target <= today, "daily completion cannot be changed for future dates");
    invariant(
      target === today ? action === "toggle" : action === "complete" || action === "decrement",
      "invalid daily completion action",
    );
    return action === "complete" ? 1 : action === "decrement" ? 0 : current ? 0 : 1;
  }
  const start = weekStart(target);
  if (start !== weekStart(today)) {
    invariant(
      addDays(start, 6) < today,
      "weekly completion can only be changed for the current week or completed past weeks",
    );
    invariant(
      action === "increment" || action === "decrement",
      "past weekly completion only supports increment or decrement action",
    );
  }
  invariant(action !== "complete", "invalid completion action");
  if (action === "decrement" || (required <= 1 && action === "toggle" && current > 0))
    return Math.max(0, current - 1);
  return current >= required ? current : current + 1;
}
export function occurrenceDates(
  record: {
    kind: string;
    scheduleType?: string | null;
    startDate: string;
    endDate?: string | null;
  },
  from: string,
  to: string,
): string[] {
  const result: string[] = [];
  for (
    let date = from > record.startDate ? from : record.startDate;
    date <= to;
    date = addDays(date, 1)
  ) {
    if (record.endDate && date > record.endDate) break;
    if (record.kind === "one_time") {
      if (date === record.startDate) result.push(date);
      break;
    }
    if (
      record.scheduleType === "daily" ||
      (record.scheduleType === "weekly" && weekday(date) === weekday(record.startDate)) ||
      (record.scheduleType === "monthly" && date.slice(8) === record.startDate.slice(8))
    )
      result.push(date);
  }
  return result;
}
export function validateReminder(r: {
  kind: string;
  scheduleType?: string | null;
  startDate: string;
  endDate?: string | null;
}) {
  if (r.kind === "one_time")
    invariant(
      !r.scheduleType && !r.endDate,
      "one-time reminder cannot have schedule type or end date",
    );
  else
    invariant(
      ["daily", "weekly", "monthly"].includes(r.scheduleType ?? "") &&
        (!r.endDate || r.endDate >= r.startDate),
      "invalid recurring reminder schedule",
    );
}
export function sortKeys(
  current: { id: string; sortKey: number }[],
  requested: string[],
): Map<string, number> {
  invariant(
    requested.length === current.length &&
      new Set(requested).size === current.length &&
      requested.every((id) => current.some((row) => row.id === id)),
    "item ids must match current items",
  );
  const original = current.map((r) => r.id);
  const keys = new Map(current.map((r) => [r.id, r.sortKey]));
  if (original.every((id, i) => requested[i] === id)) return keys;
  const moved = requested.find((id) =>
    original.filter((x) => x !== id).every((x, i) => requested.filter((y) => y !== id)[i] === x),
  );
  if (moved) {
    const index = requested.indexOf(moved),
      left = keys.get(requested[index - 1]) ?? 0,
      right = keys.get(requested[index + 1]);
    const value = right === undefined ? left + 100 : Math.floor(left + (right - left) / 2);
    if (value > left && (right === undefined || value < right) && value <= 2_147_483_647) {
      keys.set(moved, value);
      return keys;
    }
  }
  return new Map(requested.map((id, i) => [id, (i + 1) * 100]));
}
