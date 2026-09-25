import { env, waitUntil } from "cloudflare:workers";
import { createDatabase } from "../infrastructure/database";
import { createAuth } from "../infrastructure/auth";
import { authSettings } from "./auth-settings";
import { AppError } from "../domain/errors";
import { notifyTeams } from "./realtime.server";

export type RuntimeBindings = { [K in keyof Env]: Env[K] extends string ? string : Env[K] };
export async function withRuntime<T>(
  fn: (runtime: ReturnType<typeof createRuntime>) => Promise<T>,
) {
  const bindings: RuntimeBindings = env;
  // migration適用中は認証済み業務APIを停止する。
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

export function notifyChanges(bindings: RuntimeBindings, teamIds: string[]) {
  // Cloudflare公式のwaitUntilで、HTTP応答後も通知の実行を継続する。
  waitUntil(notifyTeams(bindings, teamIds));
}
