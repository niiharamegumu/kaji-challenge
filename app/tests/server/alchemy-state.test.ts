import {
  InMemoryService,
  StateStoreError,
  type CreatedResourceState,
  type StateService,
} from "alchemy/State";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { prepareProductionState, productionState } from "../../infra/state-store";

const application = (instanceId = "app-existing"): CreatedResourceState => ({
  resourceType: "Cloudflare.Worker",
  namespace: undefined,
  fqn: "Application",
  logicalId: "Application",
  instanceId,
  providerVersion: 1,
  status: "created",
  downstream: [],
  bindings: [],
  props: {},
  attr: { workerName: "app" },
});
const database: CreatedResourceState = {
  ...application("db-existing"),
  resourceType: "Cloudflare.D1.Database",
  fqn: "Database",
  logicalId: "Database",
  attr: { databaseId: "db-existing" },
};
const output = { url: "https://app.example.com", databaseId: "db-existing" };
const source = () =>
  InMemoryService(
    {
      [productionState.stack]: {
        [productionState.stage]: { Database: database, Application: application() },
        dev: { Application: application() },
      },
      otherStack: { production: { Application: application() } },
    },
    { [productionState.stack]: { [productionState.stage]: output } },
  );

describe("Alchemy production state migration", () => {
  it("copies only the production stage and keeps existing resource identities and outputs", async () => {
    const legacy = await Effect.runPromise(source());
    const destination = await Effect.runPromise(InMemoryService());
    expect(
      await Effect.runPromise(
        prepareProductionState(destination, Effect.succeed(legacy), Effect.succeed(true)),
      ),
    ).toBe("copied");
    expect(await Effect.runPromise(destination.listStacks())).toEqual([productionState.stack]);
    expect(await Effect.runPromise(destination.listStages(productionState.stack))).toEqual([
      productionState.stage,
    ]);
    expect(
      await Effect.runPromise(destination.get({ ...productionState, fqn: "Database" })),
    ).toEqual(database);
    expect(
      await Effect.runPromise(destination.get({ ...productionState, fqn: "Application" })),
    ).toEqual(application());
    expect(await Effect.runPromise(destination.getOutput(productionState))).toEqual(output);
    expect(await Effect.runPromise(legacy.getOutput(productionState))).toEqual(output);
  });

  it("resumes after a write fails and skips the copy after the output is published", async () => {
    const legacy = await Effect.runPromise(source());
    const destination = await Effect.runPromise(InMemoryService());
    const interrupted: StateService = {
      ...destination,
      set: (record) =>
        record.fqn === "Database"
          ? Effect.fail(new StateStoreError({ message: "temporary write failure" }))
          : destination.set(record),
    };
    await expect(
      Effect.runPromise(
        prepareProductionState(interrupted, Effect.succeed(legacy), Effect.succeed(true)),
      ),
    ).rejects.toThrow("temporary write failure");
    expect(await Effect.runPromise(destination.list(productionState))).toEqual(["Application"]);
    expect(await Effect.runPromise(destination.getOutput(productionState))).toBeUndefined();
    expect(
      await Effect.runPromise(
        prepareProductionState(destination, Effect.succeed(legacy), Effect.succeed(true)),
      ),
    ).toBe("copied");
    expect(
      await Effect.runPromise(
        prepareProductionState(
          destination,
          Effect.die("unexpected old store access"),
          Effect.die("unexpected database lookup"),
        ),
      ),
    ).toBe("ready");
  });

  it("stops before copying over a conflicting resource", async () => {
    const legacy = await Effect.runPromise(source());
    const destination = await Effect.runPromise(InMemoryService());
    const existing = application("different-app");
    const key = { ...productionState, fqn: "Application" };
    await Effect.runPromise(destination.set({ ...key, value: existing }));
    await expect(
      Effect.runPromise(
        prepareProductionState(destination, Effect.succeed(legacy), Effect.succeed(true)),
      ),
    ).rejects.toThrow("already has different production state");
    expect(await Effect.runPromise(destination.get(key))).toEqual(existing);
    expect(await Effect.runPromise(destination.list(productionState))).toEqual(["Application"]);
  });

  it.each([
    { productionDatabaseExists: false, allowsDeploy: true },
    { productionDatabaseExists: true, allowsDeploy: false },
  ])("checks D1 before using an empty store ($productionDatabaseExists)", async (testCase) => {
    const destination = await Effect.runPromise(InMemoryService());
    const result = Effect.runPromise(
      prepareProductionState(
        destination,
        Effect.succeed(undefined),
        Effect.succeed(testCase.productionDatabaseExists),
      ),
    );
    if (testCase.allowsDeploy) {
      await expect(result).resolves.toBe("ready");
    } else {
      await expect(result).rejects.toThrow("Production D1 exists but Alchemy has no state");
    }
  });
});
