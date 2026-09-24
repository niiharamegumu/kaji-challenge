import { z } from "zod";
import { crons } from "../src/server/application/jobs";

const booleanSetting = z.enum(["true", "false"]);
export const deploymentSchema = z.object({
  stage: z.literal("production"),
  origin: z.url().refine((value) => {
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
  }, "APP_ORIGIN must be an HTTPS origin without credentials, port, or path"),
  jobs: booleanSetting,
  maintenance: booleanSetting,
  release: z.string().min(1),
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
      compatibility: { date: "2026-09-14", flags: ["nodejs_compat"] },
      domain: new URL(settings.origin).hostname,
      workersDev: false,
      crons:
        settings.jobs === "true" && settings.maintenance === "false" ? Object.values(crons) : [],
      observability: { enabled: true, headSamplingRate: 1 },
      assets: { directory: "dist/client", runWorkerFirst: ["/api/*", "/_serverFn/*", "/health"] },
    },
  };
}
