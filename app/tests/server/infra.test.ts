import { describe, expect, it } from "vitest";
import { deploymentResources } from "../../infra/config";
const config = {
  stage: "production" as const,
  origin: "https://kaji.example.com",
  jobs: "false" as const,
  maintenance: "false" as const,
  release: "fixture",
};
describe("Alchemy deployment configuration", () => {
  it("provisions production D1 with initial migrations and same-origin assets", () => {
    const result = deploymentResources(config);
    expect(result.database).toEqual({
      name: "kaji-production",
      primaryLocationHint: "apac",
      readReplication: { mode: "disabled" },
      migrations: "./migrations",
    });
    expect(result.worker).toMatchObject({
      main: "src/server-entry.ts",
      domain: "kaji.example.com",
      workersDev: false,
      crons: [],
      observability: { enabled: true, headSamplingRate: 1 },
      assets: { runWorkerFirst: ["/api/*", "/_serverFn/*", "/health"] },
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
