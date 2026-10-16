import { addDays, isDate, midnightJST, weekStart, weekday } from "./dates";
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
export type CompletionAction = "complete" | "incomplete" | "increment" | "decrement";
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
    invariant(action === "complete" || action === "incomplete", "invalid daily completion action");
    return action === "complete" ? 1 : 0;
  }
  const start = weekStart(target);
  invariant(
    start === weekStart(today) || addDays(start, 6) < today,
    "weekly completion can only be changed for the current week or completed past weeks",
  );
  invariant(
    action === "increment" ||
      action === "decrement" ||
      (required === 1 && (action === "complete" || action === "incomplete")),
    "invalid weekly completion action",
  );
  if (action === "complete") return 1;
  if (action === "incomplete") return 0;
  return Math.max(0, Math.min(required, current + (action === "increment" ? 1 : -1)));
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
    // Do not advance past the inclusive end (9999-12-31 has no next 4-digit date).
    if (date === to) break;
  }
  return result;
}
export function validateReminderRange(from: string, to: string) {
  invariant(isDate(from) && isDate(to), "invalid reminder date range");
  invariant(to >= from, "to must be on or after from");
  // Inclusive endpoints allow a full leap year while bounding recurrence expansion.
  invariant(
    Date.parse(to) - Date.parse(from) <= 365 * 86_400_000,
    "reminder date range must be 366 days or fewer",
  );
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
/** 並び替え対象の過不足・重複を検証する。sort_keyの採番はRepositoryで行う。 */
export function validateReorder(currentIds: string[], requestedIds: string[]): void {
  const current = new Set(currentIds);
  invariant(
    requestedIds.length === current.size &&
      new Set(requestedIds).size === current.size &&
      requestedIds.every((id) => current.has(id)),
    "item ids must match current items",
  );
}
