import { isApiRequestError } from "../../lib/api/client";

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

export const todayString = () => new Date().toISOString().slice(0, 10);

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

export const isPreconditionFailed = (error: unknown) =>
  extractHttpStatus(error) === 412;
