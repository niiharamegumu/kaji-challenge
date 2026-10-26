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
  return dateLabelFormatter.format(new Date(`${dateKey}T00:00:00Z`));
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
