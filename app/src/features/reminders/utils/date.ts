import { dateStringInJST } from "../../../shared/utils/errors";

export function todayDateKey(date: Date = new Date()) {
  return dateStringInJST(date);
}

export function monthKeyFromDateKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

export function monthStartDateKey(monthKey: string) {
  return `${monthKey}-01`;
}

export function monthEndDateKey(monthKey: string) {
  const [yearPart, monthPart] = monthKey.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const lastDay = new Date(Date.UTC(year, month, 0));
  return `${yearPart}-${String(month).padStart(2, "0")}-${String(lastDay.getUTCDate()).padStart(2, "0")}`;
}

export function endOfWeekDateKey(dateKey: string) {
  const date = parseDateKey(dateKey);
  const weekday = date.getUTCDay();
  const delta = weekday === 0 ? 0 : 7 - weekday;
  date.setUTCDate(date.getUTCDate() + delta);
  return formatDateKey(date);
}

// Date-only keys are calendar dates, not instants. Use UTC fields to avoid device/DST shifts.
export function parseDateKey(dateKey: string) {
  const [yearPart, monthPart, dayPart] = dateKey.split("-");
  return new Date(Date.UTC(Number(yearPart), Number(monthPart) - 1, Number(dayPart)));
}

export function formatDateKey(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function formatMonthLabel(monthKey: string) {
  const [yearPart, monthPart] = monthKey.split("-");
  return `${yearPart}年${monthPart}月`;
}

export function formatDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(parseDateKey(dateKey));
}

export function normalizeDateKey(value: string | null | undefined) {
  if (value == null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return todayDateKey();
  }
  return value;
}
