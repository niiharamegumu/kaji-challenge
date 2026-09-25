import { describe, expect, it } from "vitest";
import { unstable_readConfig } from "wrangler";
import { deploymentResources } from "../../infra/config";
const config = {
  stage: "production" as const,
  origin: "https://kaji.example.com",
  jobs: "false" as const,
  maintenance: "false" as const,
  release: "fixture",
};
describe("Alchemy deployment configuration", () => {
  it("keeps the local and deployment Worker compatibility settings aligned", () => {
    const local = unstable_readConfig({
      config: new URL("../../wrangler.jsonc", import.meta.url).pathname,
    });
    expect(local.durable_objects.bindings).toContainEqual({
      name: "TEAM_REALTIME",
      class_name: "TeamRealtime",
    });
    expect(local.exports.TeamRealtime).toMatchObject({
      type: "durable-object",
      storage: "sqlite",
    });
    expect(deploymentResources(config).worker.compatibility).toEqual({
      date: local.compatibility_date,
      flags: local.compatibility_flags,
    });
  });
  it("provisions production D1 with initial migrations and same-origin assets", () => {
    const result = deploymentResources(config);
    expect(result.database).toEqual({
      name: "kaji-production",
      primaryLocationHint: "apac",
      readReplication: { mode: "disabled" },
      migrations: "./migrations",
    });
    expect(result.worker).toMatchObject({
      main: "dist/server/index.js",
      bundle: false,
      domain: "kaji.example.com",
      workersDev: false,
      crons: [],
      observability: { enabled: true, headSamplingRate: 1 },
      assets: { directory: "dist/client", runWorkerFirst: ["/api/*", "/_serverFn/*", "/health"] },
    });
  });
  it("enables all five schedules only outside maintenance", () => {
    expect(deploymentResources({ ...config, jobs: "true" }).worker.crons).toHaveLength(5);
    expect(
      deploymentResources({ ...config, jobs: "true", maintenance: "true" }).worker.crons,
    ).toEqual([]);
  });
  it.each([
    { origin: "http://example.com" },
    { origin: "https://example.com/path" },
    { origin: "https://user:password@example.com" },
    { jobs: "yes" },
    { stage: "prodution" },
    { stage: "staging" },
    { stage: "local" },
  ])("rejects unsafe or mistyped settings %j", (invalid) => {
    expect(() => deploymentResources({ ...config, ...invalid } as typeof config)).toThrow();
  });
});
