export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly currentState?: { teamId: string; revision: string },
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function invariant(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition)
    throw new AppError(
      status,
      status === 404 ? "not_found" : status === 403 ? "forbidden" : "invalid_request",
      message,
    );
}
