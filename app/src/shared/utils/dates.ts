const jstDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateLabelFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  weekday: "short",
});

export function formatDateLabel(dateKey: string) {
  return dateLabelFormatter.format(parseDateKey(dateKey));
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

export const dateStringInJST = (date: Date = new Date()) => {
  const parts = jstDateFormatter.formatToParts(date);
  const getPart = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
};

export function endOfWeekDateKey(dateKey: string) {
  const date = parseDateKey(dateKey);
  const weekday = date.getUTCDay();
  const delta = weekday === 0 ? 0 : 7 - weekday;
  date.setUTCDate(date.getUTCDate() + delta);
  return formatDateKey(date);
}

// Date-only keys are calendar dates, not instants. Use UTC fields to avoid device/DST shifts.
export function parseDateKey(dateKey: string) {
  return new Date(`${dateKey}T00:00:00Z`);
}

export function formatDateKey(date: Date) {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function formatMonthLabel(monthKey: string) {
  const [yearPart, monthPart] = monthKey.split("-");
  return `${yearPart}年${monthPart}月`;
}
