export function todayDateKey(date: Date = new Date()) {
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
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
  const lastDay = new Date(year, month, 0);
  return `${yearPart}-${String(month).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
}

export function endOfWeekDateKey(dateKey: string) {
  const date = parseDateKey(dateKey);
  const weekday = date.getDay();
  const delta = weekday === 0 ? 0 : 7 - weekday;
  date.setDate(date.getDate() + delta);
  return formatDateKey(date);
}

export function parseDateKey(dateKey: string) {
  const [yearPart, monthPart, dayPart] = dateKey.split("-");
  return new Date(
    Number(yearPart),
    Number(monthPart) - 1,
    Number(dayPart),
    12,
    0,
    0,
    0,
  );
}

export function formatDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function formatMonthLabel(monthKey: string) {
  const [yearPart, monthPart] = monthKey.split("-");
  return `${yearPart}年${monthPart}月`;
}

export function formatDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
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
