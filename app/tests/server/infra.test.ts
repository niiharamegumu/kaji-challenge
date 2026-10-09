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
      assets: {
        directory: "dist/client",
        runWorkerFirst: ["/api/*", "/_serverFn/*", "/.well-known/*", "/health"],
      },
    });
  });
  it("enables all five schedules only outside maintenance", () => {
    expect(deploymentResources({ ...config, jobs: "true" }).worker.crons).toHaveLength(5);
    expect(
      deploymentResources({ ...config, jobs: "true", maintenance: "true" }).worker.crons,
    ).toEqual([]);
  });
  it("does not add MCP resources until a separate origin is configured", () => {
    const result = deploymentResources(config);
    expect(result.settings.mcpEnabled).toBe("false");
    expect(result.settings.mcpOrigin).toBe("");
    expect(result.mcp).toBeUndefined();
  });
  it("keeps provisioned MCP resources when its runtime gate is disabled", () => {
    const origin = { ...config, mcpOrigin: "https://mcp.example.com" };
    const disabled = deploymentResources({ ...origin, mcpEnabled: "false" });
    const enabled = deploymentResources({ ...origin, mcpEnabled: "true" });
    expect(disabled.mcp).toEqual(enabled.mcp);
    expect(disabled.mcp).toEqual({
      oauthKv: { title: "kaji-production-mcp-oauth" },
      worker: {
        main: "dist/mcp/index.js",
        bundle: false,
        compatibility: { date: "2026-09-14", flags: ["nodejs_compat"] },
        domain: "mcp.example.com",
        workersDev: false,
        crons: [],
        observability: { enabled: true, headSamplingRate: 1 },
      },
    });
    expect(disabled.database).toEqual(deploymentResources(config).database);
    expect(disabled.worker).toEqual(deploymentResources(config).worker);
  });
  it("normalizes a valid MCP origin before binding it to either Worker", () => {
    const result = deploymentResources({
      ...config,
      mcpEnabled: "true",
      mcpOrigin: "https://mcp.example.com/",
    });
    expect(result.settings.mcpOrigin).toBe("https://mcp.example.com");
    expect(result.mcp?.worker.domain).toBe("mcp.example.com");
  });
  it("binds local OAuth storage to the application and only its named RPC to MCP", () => {
    const application = unstable_readConfig({
      config: new URL("../../wrangler.jsonc", import.meta.url).pathname,
    });
    const mcp = unstable_readConfig({
      config: new URL("../../wrangler.mcp.jsonc", import.meta.url).pathname,
    });
    expect(application.kv_namespaces).toEqual([
      { binding: "OAUTH_KV", id: "00000000000000000000000000000002" },
    ]);
    expect(application.exports.McpApplication).toEqual({ type: "worker" });
    expect(application.vars.MCP_ENABLED).toBe("false");
    expect(mcp.services).toEqual([
      { binding: "KAJI_APPLICATION", service: application.name, entrypoint: "McpApplication" },
    ]);
    expect(mcp.d1_databases).toEqual([]);
    expect(mcp.kv_namespaces).toEqual([]);
    expect(mcp.secrets).toEqual({ required: [] });
    expect(mcp.vars.MCP_ENABLED).toBe("false");
    expect(mcp.compatibility_date).toEqual(application.compatibility_date);
    expect(mcp.compatibility_flags).toEqual(["nodejs_compat"]);
    expect(application.compatibility_flags).toContain("global_fetch_strictly_public");
    expect(mcp.vars.APP_ORIGIN).toEqual(application.vars.APP_ORIGIN);
    expect(mcp.vars.MCP_ORIGIN).toEqual(application.vars.MCP_ORIGIN);
  });
  it.each([
    { origin: "http://example.com" },
    { origin: "https://example.com/path" },
    { origin: "https://user:password@example.com" },
    { jobs: "yes" },
    { stage: "prodution" },
    { stage: "staging" },
    { stage: "local" },
    { mcpEnabled: "true" },
    { mcpEnabled: "yes" },
    { mcpOrigin: "http://mcp.example.com" },
    { mcpOrigin: "https://mcp.example.com/path" },
    { mcpOrigin: "https://mcp.example.com:8443" },
    { mcpOrigin: "https://user:password@mcp.example.com" },
    { mcpOrigin: "https://kaji.example.com/" },
  ])("rejects unsafe or mistyped settings %j", (invalid) => {
    expect(() => deploymentResources({ ...config, ...invalid } as typeof config)).toThrow();
  });
});
