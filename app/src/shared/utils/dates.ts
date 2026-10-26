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

export const dateStringInJST = (date: Date = new Date()) => {
  const parts = jstDateFormatter.formatToParts(date);
  const getPart = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
};
