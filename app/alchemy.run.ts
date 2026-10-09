import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { deploymentResources } from "./infra/config";
import type { McpApplication } from "./src/server/transport/mcp-entrypoint";

export default Alchemy.Stack(
  "kaji-challenge",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const origin = yield* Config.String("APP_ORIGIN");
    const jobs = yield* Config.String("JOBS_ENABLED").pipe(Config.withDefault("false"));
    const resources = deploymentResources({
      stage: yield* Alchemy.Stage,
      origin,
      jobs,
      maintenance: yield* Config.String("MAINTENANCE_MODE").pipe(Config.withDefault("false")),
      release: yield* Config.String("APP_RELEASE"),
      mcpEnabled: yield* Config.String("MCP_ENABLED").pipe(Config.withDefault("false")),
      mcpOrigin: yield* Config.String("MCP_ORIGIN").pipe(Config.withDefault("")),
    });
    const database = yield* Cloudflare.D1.Database("Database", resources.database);
    const realtime = Cloudflare.DurableObject("TeamRealtime", { className: "TeamRealtime" });
    const oauthKv = resources.mcp
      ? yield* Cloudflare.KV.Namespace("McpOAuthKV", resources.mcp.oauthKv).pipe(
          Alchemy.RemovalPolicy.retain(),
        )
      : undefined;
    const worker = yield* Cloudflare.Worker("Application", {
      ...resources.worker,
      env: {
        DB: database,
        TEAM_REALTIME: realtime,
        APP_ORIGIN: origin,
        APP_RELEASE: resources.settings.release,
        JOBS_ENABLED: jobs,
        MAINTENANCE_MODE: resources.settings.maintenance,
        MCP_ENABLED: resources.settings.mcpEnabled,
        MCP_ORIGIN: resources.settings.mcpOrigin,
        ...(oauthKv ? { OAUTH_KV: oauthKv } : {}),
        SIGNUP_ALLOWED_EMAILS: Config.Redacted("SIGNUP_ALLOWED_EMAILS"),
        BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
        GOOGLE_CLIENT_ID: Config.Redacted("GOOGLE_CLIENT_ID"),
        GOOGLE_CLIENT_SECRET: Config.Redacted("GOOGLE_CLIENT_SECRET"),
        VAPID_PUBLIC_KEY: yield* Config.String("VAPID_PUBLIC_KEY"),
        VAPID_PRIVATE_KEY: Config.Redacted("VAPID_PRIVATE_KEY"),
        VAPID_SUBJECT: yield* Config.String("VAPID_SUBJECT"),
      },
    });
    if (resources.mcp) {
      const mcp = yield* Cloudflare.Worker("Mcp", {
        ...resources.mcp.worker,
        env: {
          KAJI_APPLICATION: Cloudflare.WorkerEntrypoint<McpApplication>(worker, "McpApplication"),
          APP_ORIGIN: new URL(resources.settings.origin).origin,
          APP_RELEASE: resources.settings.release,
          MCP_ENABLED: resources.settings.mcpEnabled,
          MCP_ORIGIN: resources.settings.mcpOrigin,
          MAINTENANCE_MODE: resources.settings.maintenance,
        },
      });
      return { url: worker.url, databaseId: database.databaseId, mcpUrl: mcp.url };
    }
    return { url: worker.url, databaseId: database.databaseId };
  }),
);
