import { describe, expect, it } from "vitest";
import { AppError } from "../../src/server/domain/errors";
import { operationError } from "../../src/server/transport/operation-error";

describe("operation errors", () => {
  it("preserves safe application errors", () => {
    expect(operationError(new AppError(403, "forbidden", "Forbidden"))).toEqual({
      status: 403,
      code: "forbidden",
      message: "Forbidden",
    });
  });
  it("maps direct and wrapped D1 uniqueness errors without exposing query data", () => {
    const d1Error = new Error("D1_ERROR: UNIQUE constraint failed: private column");
    for (const error of [
      d1Error,
      new Error("Failed query: private SQL and parameters", { cause: d1Error }),
    ]) {
      expect(operationError(error)).toEqual({
        status: 409,
        code: "conflict",
        message: "同じ内容がすでに登録されています。",
      });
    }
  });
  it("hides unknown errors and terminates cyclic cause chains", () => {
    const cyclic = new Error("private details");
    cyclic.cause = cyclic;
    for (const error of [
      cyclic,
      null,
      new Error("private SQL", { cause: new Error("FOREIGN KEY constraint failed") }),
    ]) {
      expect(operationError(error)).toEqual({
        status: 500,
        code: "internal_error",
        message: "処理に失敗しました。再度お試しください。",
      });
    }
  });
});
