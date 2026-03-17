import { isApiRequestError } from "../../lib/api/client";

const jstDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const dateStringInJST = (date: Date = new Date()) => {
  const parts = jstDateFormatter.formatToParts(date);
  const getPart = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
};

export const extractHttpStatus = (error: unknown): number | null => {
  if (isApiRequestError(error)) {
    return error.status;
  }
  const raw = String(error);
  const status = raw.match(/\b(\d{3})\b/)?.[1];
  if (status == null) {
    return null;
  }
  const parsed = Number(status);
  return Number.isNaN(parsed) ? null : parsed;
};

export const todayString = (date: Date = new Date()) => dateStringInJST(date);

export const formatError = (error: unknown) => {
  if (isApiRequestError(error) && error.message !== "") {
    const status = extractHttpStatus(error);
    if (status != null) {
      return `${error.message}（HTTP ${status}）`;
    }
    return error.message;
  }
  const status = extractHttpStatus(error);
  if (status != null) {
    return `通信エラー（HTTP ${status}）`;
  }
  return "通信エラー";
};

export const isPreconditionFailure = (error: unknown) => {
  const status = extractHttpStatus(error);
  return status === 412 || status === 428;
};
