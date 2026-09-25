import { AppError } from "../domain/errors";

export function operationError(error: unknown) {
  if (error instanceof AppError)
    return {
      status: error.status,
      code: error.code,
      message: error.message,
    };

  // D1/Drizzle can wrap errors. Never return database details or query parameters.
  const seen = new Set<object>();
  let cause = error;
  while (cause && typeof cause === "object" && !seen.has(cause)) {
    seen.add(cause);
    if (
      "message" in cause &&
      typeof cause.message === "string" &&
      /(?:UNIQUE|PRIMARY KEY) constraint failed/.test(cause.message)
    )
      return {
        status: 409,
        code: "conflict",
        message: "同じ内容がすでに登録されています。",
      };
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return {
    status: 500,
    code: "internal_error",
    message: "処理に失敗しました。再度お試しください。",
  };
}
