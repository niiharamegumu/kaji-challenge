import { isDeepStrictEqual } from "node:util";
import { encodeState, type StateService } from "alchemy/State";
import * as Effect from "effect/Effect";

export const stateStoreWorkerName = "kaji-challenge-alchemy-state-store";
export const legacyStateStoreWorkerName = "alchemy-state-store";
export const productionState = { stack: "kaji-challenge", stage: "production" } as const;

type LegacyState = Pick<StateService, "list" | "get" | "getOutput">;
const databaseResourceId = "Database";
const hasCoreResources = (keys: readonly string[]) =>
  keys.includes(databaseResourceId) && keys.includes("Application");

export class ProductionStateError extends Error {}

export const prepareProductionState = Effect.fn(function* <
  LegacyError,
  LegacyServices,
  DbError,
  DbServices,
>(
  destination: StateService,
  readLegacy: Effect.Effect<LegacyState | undefined, LegacyError, LegacyServices>,
  productionDatabaseExists: Effect.Effect<boolean, DbError, DbServices>,
) {
  const destinationKeys = yield* destination.list(productionState);
  if ((yield* destination.getOutput(productionState)) !== undefined) {
    if (!hasCoreResources(destinationKeys)) {
      return yield* Effect.fail(
        new ProductionStateError("Production state in the new store is incomplete."),
      );
    }
    return "ready";
  }

  const legacy = yield* readLegacy;
  const legacyKeys = legacy ? yield* legacy.list(productionState) : [];
  if (!legacy || legacyKeys.length === 0) {
    if (!destinationKeys.includes(databaseResourceId) && (yield* productionDatabaseExists)) {
      return yield* Effect.fail(
        new ProductionStateError(
          "Production D1 exists but Alchemy has no state for it. Restore its state before deploying.",
        ),
      );
    }
    return "ready";
  }

  const output = yield* legacy.getOutput(productionState);
  if (!hasCoreResources(legacyKeys) || output === undefined) {
    return yield* Effect.fail(
      new ProductionStateError("Production state in the old store is incomplete."),
    );
  }
  if (destinationKeys.some((fqn) => !legacyKeys.includes(fqn))) {
    return yield* Effect.fail(
      new ProductionStateError("The new store already has different production state."),
    );
  }

  // Copy the database record last so an interrupted copy cannot look like an initial deploy retry.
  const copyOrder = [...legacyKeys.filter((fqn) => fqn !== databaseResourceId), databaseResourceId];
  const records = yield* Effect.forEach(copyOrder, (fqn) =>
    Effect.gen(function* () {
      const key = { ...productionState, fqn };
      const value = yield* legacy.get(key);
      if (value === undefined) {
        return yield* Effect.fail(
          new ProductionStateError("Old production state changed during the migration."),
        );
      }
      const existing = yield* destination.get(key);
      if (existing !== undefined && !isDeepStrictEqual(encodeState(existing), encodeState(value))) {
        return yield* Effect.fail(
          new ProductionStateError("The new store already has different production state."),
        );
      }
      return { ...key, value, missing: existing === undefined };
    }),
  );
  for (const { missing, ...record } of records) {
    if (missing) yield* destination.set(record);
  }
  // Only publish the output after every resource record has been copied.
  yield* destination.setOutput({ ...productionState, value: output });
  return "copied";
});
