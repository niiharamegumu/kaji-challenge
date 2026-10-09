import { z } from "zod";
import { crons } from "../src/server/application/jobs";

const booleanSetting = z.enum(["true", "false"]);
const productionOrigin = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash &&
    url.hostname !== "localhost"
  );
}, "Must be an HTTPS origin without credentials, port, or path");
export const deploymentSchema = z
  .object({
    stage: z.literal("production"),
    origin: productionOrigin,
    jobs: booleanSetting,
    maintenance: booleanSetting,
    release: z.string().min(1),
    mcpEnabled: booleanSetting.default("false"),
    mcpOrigin: z
      .union([productionOrigin.transform((value) => new URL(value).origin), z.literal("")])
      .default(""),
  })
  .superRefine((settings, context) => {
    if (settings.mcpEnabled === "true" && !settings.mcpOrigin) {
      context.addIssue({
        code: "custom",
        path: ["mcpOrigin"],
        message: "MCP_ORIGIN is required when MCP is enabled",
      });
    } else if (
      settings.mcpOrigin &&
      new URL(settings.mcpOrigin).origin === new URL(settings.origin).origin
    ) {
      context.addIssue({
        code: "custom",
        path: ["mcpOrigin"],
        message: "MCP_ORIGIN must differ from APP_ORIGIN",
      });
    }
  });
export function deploymentResources(input: unknown) {
  const settings = deploymentSchema.parse(input);
  return {
    settings,
    database: {
      name: `kaji-${settings.stage}`,
      primaryLocationHint: "apac" as const,
      readReplication: { mode: "disabled" as const },
      migrations: "./migrations",
    },
    worker: {
      // Cloudflare公式Vite pluginが生成したWorkerを再bundleせず配備する。
      main: "dist/server/index.js",
      bundle: false,
      compatibility: {
        date: "2026-09-14",
        flags: ["nodejs_compat", "global_fetch_strictly_public"],
      },
      domain: new URL(settings.origin).hostname,
      workersDev: false,
      crons:
        settings.jobs === "true" && settings.maintenance === "false" ? Object.values(crons) : [],
      observability: { enabled: true, headSamplingRate: 1 },
      assets: {
        directory: "dist/client",
        runWorkerFirst: ["/api/*", "/_serverFn/*", "/.well-known/*", "/health"],
      },
    },
    mcp: settings.mcpOrigin
      ? {
          oauthKv: { title: `kaji-${settings.stage}-mcp-oauth` },
          worker: {
            main: "dist/mcp/index.js",
            bundle: false,
            compatibility: { date: "2026-09-14", flags: ["nodejs_compat"] },
            domain: new URL(settings.mcpOrigin).hostname,
            workersDev: false,
            crons: [],
            observability: { enabled: true, headSamplingRate: 1 },
          },
        }
      : undefined,
  };
}
