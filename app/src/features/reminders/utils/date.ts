import { dateStringInJST } from "../../../shared/utils/dates";
export { formatDateLabel, monthStartDateKey, monthEndDateKey } from "../../../shared/utils/dates";

export function todayDateKey(date: Date = new Date()) {
  return dateStringInJST(date);
}

export function monthKeyFromDateKey(dateKey: string) {
  return dateKey.slice(0, 7);
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

export function normalizeDateKey(value: string | null | undefined) {
  if (value == null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return todayDateKey();
  }
  return value;
}
