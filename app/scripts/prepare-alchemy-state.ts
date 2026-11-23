import { Access, CloudflareApiLive, CloudflareEnvironment } from "@alchemy.run/cloudflare";
import { loginWithCloudflare } from "@alchemy.run/cloudflare/StateStore/State";
import { listDatabases } from "@distilled.cloud/cloudflare/d1";
import { getScriptSetting } from "@distilled.cloud/cloudflare/workers";
import * as Alchemist from "alchemy/Alchemist";
import { currentProfileName } from "alchemy/Auth/Profile";
import { AuthProvidersLive } from "alchemy/Auth/Registry";
import { makeHttpStateStore } from "alchemy/State";
import * as Effect from "effect/Effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { productionDatabaseName } from "../infra/config";
import {
  legacyStateStoreWorkerName,
  prepareProductionState,
  ProductionStateError,
  stateStoreWorkerName,
} from "../infra/state-store";

const readLegacy = Effect.gen(function* () {
  const { accountId } = yield* yield* CloudflareEnvironment;
  const exists = yield* getScriptSetting({
    accountId,
    scriptName: legacyStateStoreWorkerName,
  }).pipe(
    Effect.as(true),
    Effect.catchTag(["WorkerNotFound", "WorkerHasNoVersions", "InvalidRoute"], () =>
      Effect.succeed(false),
    ),
  );
  if (!exists) return undefined;

  // Open the old HTTP store directly because the configured state layer requires a v8 upgrade.
  const credentials = yield* loginWithCloudflare(
    yield* currentProfileName,
    true,
    legacyStateStoreWorkerName,
    accountId,
  );
  const access = yield* Access.Access;
  const headers = yield* access.getAccessHeaders(new URL(credentials.url).host);
  return yield* makeHttpStateStore({
    ...credentials,
    id: "cloudflare-http",
    transformClient: HttpClientRequest.setHeaders(headers),
  });
});

const productionDatabaseExists = Effect.gen(function* () {
  const { accountId } = yield* yield* CloudflareEnvironment;
  return yield* listDatabases.items({ accountId, name: productionDatabaseName }).pipe(
    Stream.filter((entry) => entry.name === productionDatabaseName),
    Stream.runHead,
    Effect.map(Option.isSome),
  );
});

const cloudflareApi = CloudflareApiLive().pipe(Layer.provide(AuthProvidersLive));
const prepare = Effect.gen(function* () {
  const destination = yield* Alchemist.State.store({ type: "configured" });
  return yield* prepareProductionState(
    destination,
    readLegacy.pipe(Effect.provide(cloudflareApi)),
    productionDatabaseExists.pipe(Effect.provide(cloudflareApi)),
  );
}).pipe(Effect.provide(Alchemist.layer()), Effect.scoped);

try {
  const result = await Effect.runPromise(prepare);
  console.info(
    result === "copied"
      ? `Copied production Alchemy state to ${stateStoreWorkerName}.`
      : `Production Alchemy state is ready in ${stateStoreWorkerName}.`,
  );
} catch (error) {
  console.error(
    error instanceof ProductionStateError
      ? error.message
      : "Could not prepare the production Alchemy state. Check state store access and retry.",
  );
  process.exitCode = 1;
}
