import { env } from "cloudflare:workers";
import { createDatabase } from "../infrastructure/database";
import { createAuth } from "../infrastructure/auth";
import { authSettings } from "./auth-settings";
import { AppError } from "../domain/errors";
export type RuntimeBindings = { [K in keyof Env]: Env[K] extends string ? string : Env[K] };
export async function withRuntime<T>(
  fn: (runtime: Awaited<ReturnType<typeof createRuntime>>) => Promise<T>,
) {
  const bindings: RuntimeBindings = env;
  // Read operations also perform housekeeping/summary writes. Freeze all business
  // requests before accessing D1 so the maintenance flag actually stops DB writes.
  if (bindings.MAINTENANCE_MODE === "true")
    throw new AppError(
      503,
      "maintenance",
      "メンテナンス中です。しばらくしてから再操作してください。",
    );
  return fn(createRuntime(bindings));
}
export function createRuntime(bindings: RuntimeBindings) {
  const settings = authSettings(bindings);
  const connection = createDatabase(bindings.DB);
  return { ...connection, auth: createAuth(connection.db, settings), bindings };
}
