import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { deploymentResources } from "./infra/config";

export default Alchemy.Stack(
  "kaji-challenge",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const origin = yield* Config.string("APP_ORIGIN");
    const jobs = yield* Config.string("JOBS_ENABLED").pipe(Config.withDefault("false"));
    const resources = deploymentResources({
      stage: yield* Alchemy.Stage,
      origin,
      jobs,
      maintenance: yield* Config.string("MAINTENANCE_MODE").pipe(Config.withDefault("false")),
      release: yield* Config.string("APP_RELEASE"),
    });
    const database = yield* Cloudflare.D1.Database("Database", resources.database);
    const realtime = Cloudflare.DurableObject("TeamRealtime", { className: "TeamRealtime" });
    const worker = yield* Cloudflare.Worker("Application", {
      ...resources.worker,
      env: {
        DB: database,
        TEAM_REALTIME: realtime,
        APP_ORIGIN: origin,
        APP_RELEASE: resources.settings.release,
        JOBS_ENABLED: jobs,
        MAINTENANCE_MODE: resources.settings.maintenance,
        SIGNUP_ALLOWED_EMAILS: Config.redacted("SIGNUP_ALLOWED_EMAILS"),
        BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
        GOOGLE_CLIENT_ID: Config.redacted("GOOGLE_CLIENT_ID"),
        GOOGLE_CLIENT_SECRET: Config.redacted("GOOGLE_CLIENT_SECRET"),
        VAPID_PUBLIC_KEY: yield* Config.string("VAPID_PUBLIC_KEY"),
        VAPID_PRIVATE_KEY: Config.redacted("VAPID_PRIVATE_KEY"),
        VAPID_SUBJECT: yield* Config.string("VAPID_SUBJECT"),
      },
    });
    return { url: worker.url, databaseId: database.databaseId };
  }),
);
