import type { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { operationSchema, responseSchemas } from "../../contracts/operations";
import { AppError } from "../domain/errors";
import { executeOperation } from "../application/operations";
import { operationError } from "./operation-error";
import type { TeamState } from "../../contracts/operations";
export type WireResult =
  | {
      ok: true;
      data: z.output<(typeof responseSchemas)[keyof typeof responseSchemas]>;
      state: TeamState;
    }
  | {
      ok: false;
      error: { status: number; code: string; message: string; currentState?: TeamState };
    };
export const invokeOperation = createServerFn({ method: "POST" })
  .validator((raw: unknown) => {
    const parsed = operationSchema.safeParse(raw);
    // Keep the app's typed error response without exposing Zod input details.
    return parsed.success ? parsed.data : null;
  })
  .handler(async ({ data: input }): Promise<WireResult> => {
    if (!input)
      return {
        ok: false,
        error: { status: 400, code: "invalid_request", message: "入力内容を確認してください。" },
      };
    const startedAt = performance.now();
    let status = 200;
    try {
      const { withRuntime } = await import("./runtime.server");
      return await withRuntime(async (runtime) => {
        const headers = getRequestHeaders(),
          origin = headers.get("origin");
        if (origin && origin !== new URL(runtime.bindings.APP_ORIGIN).origin)
          throw new AppError(403, "forbidden", "Invalid origin");
        if (headers.get("sec-fetch-site") === "cross-site")
          throw new AppError(403, "forbidden", "Invalid request origin");
        const session = await runtime.auth.api.getSession({ headers });
        if (!session) throw new AppError(401, "unauthorized", "ログインしてください。");
        return runtime.repository.transaction(async (repository) => {
          const result = await executeOperation(repository, input, {
            userId: session.user.id,
            now: new Date(),
            vapidPublicKey: runtime.bindings.VAPID_PUBLIC_KEY,
          });
          const validated = responseSchemas[input.operation].parse(result.data);
          return { ok: true, data: validated, state: result.state };
        });
      });
    } catch (error) {
      const mapped = operationError(error);
      status = mapped.status;
      if (status >= 500)
        console.error(
          JSON.stringify({
            event: "operation_failed",
            operation: input.operation,
            errorName: error instanceof Error ? error.name : "UnknownError",
          }),
        );
      return { ok: false, error: mapped };
    } finally {
      console.info(
        JSON.stringify({
          event: "operation_finished",
          status,
          operation: input.operation,
          durationMs: Math.round(performance.now() - startedAt),
        }),
      );
    }
  });
