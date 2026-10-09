import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Stack } from "alchemy/Alchemist";
import { deploymentResources } from "../infra/config";
import {
  assertNoBootstrap,
  DeploymentGuardError,
  deploymentPlanOnly,
  deploymentPlanningPhase,
  deploymentPlanSummary,
  routeMatchesHostname,
  safeDeploymentFailure,
  validateDeploymentPlan,
  validateMigrationFiles,
  validateMigrationLedger,
} from "../infra/deployment-plan";

// Never print raw provider failures, plan.native, plan.session, credentials or binding values.
let phase = "validate configuration";
let safeFailure: string | undefined;
function recordGuardFailure(error: unknown): never {
  if (error instanceof DeploymentGuardError) safeFailure = error.message;
  throw error;
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new DeploymentGuardError(message);
}

async function migrationHashes() {
  const files = await readdir("migrations", { withFileTypes: true });
  check(
    files.every((file) => file.isFile() && file.name.endsWith(".sql")),
    "Unexpected migration directory contents",
  );
  const hashes = Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file.name,
        createHash("sha256")
          .update(await readFile(join("migrations", file.name), "utf8"))
          .digest("hex"),
      ]),
    ),
  );
  validateMigrationFiles(hashes);
  return hashes;
}

type CloudflareResponse<T> = {
  success: boolean;
  result: T;
  result_info?: { total_pages?: number };
};
async function cloudflare<T>(path: string, body?: { sql: string }): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  check(
    response.ok,
    `Cloudflare preflight failed (HTTP ${response.status}); no permissions are added automatically`,
  );
  const data = (await response.json()) as CloudflareResponse<T>;
  check(
    data.success && (data.result_info?.total_pages ?? 1) <= 1,
    "Incomplete Cloudflare preflight result",
  );
  return data.result;
}

function nativeResource(snapshot: Stack.PlanSnapshot, id: string) {
  const node = snapshot.native.resources[id];
  check(
    node && (node.action === "noop" || node.action === "update" || node.action === "create"),
    "Unexpected native plan resource",
  );
  check(
    !node.renamedFrom?.length && !("adopting" in node && node.adopting),
    "Resource adoption or rename is not approved",
  );
  return node;
}

async function validatePreflight(
  snapshot: Stack.PlanSnapshot,
  configuration: ReturnType<typeof deploymentResources>,
  hashes: Record<string, string>,
) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID!;
  const database = nativeResource(snapshot, "Database");
  const application = nativeResource(snapshot, "Application");
  check(
    database.state && "attr" in database.state && application.state && "attr" in application.state,
    "Existing deployment state is required",
  );
  const db = database.state.attr;
  const app = application.state.attr;
  check(
    db?.accountId === accountId &&
      db.databaseName === "kaji-production" &&
      /^[a-f0-9-]{36}$/i.test(db.databaseId),
    "Unexpected existing database identity",
  );
  check(
    typeof app?.workerName === "string" && app.workerName.length > 0,
    "Existing application identity is required",
  );
  const props = database.action === "noop" ? database.state.props : database.props;
  check(
    isDeepStrictEqual(props, configuration.database),
    "Database configuration is outside this approval",
  );
  check(db.migrationsTable === "__alchemy_migrations", "Unexpected migration ledger");
  const oldHashes = db.migrationsHashes as Record<string, string>;
  check(
    oldHashes &&
      Object.keys(oldHashes).length >= 7 &&
      Object.keys(oldHashes).every((name) => oldHashes[name] === hashes[name]),
    "Changed historical migration in deployment state",
  );
  for (const id of ["Application", ...(configuration.mcp ? ["Mcp"] : [])]) {
    const node = nativeResource(snapshot, id);
    const desired = node.action === "noop" ? node.state.props : node.props;
    const { env: _env, ...workerProps } = desired;
    check(
      isDeepStrictEqual(
        workerProps,
        id === "Application" ? configuration.worker : configuration.mcp!.worker,
      ),
      "Worker configuration is outside this approval",
    );
  }
  if (configuration.mcp) {
    const kv = nativeResource(snapshot, "McpOAuthKV");
    check(
      isDeepStrictEqual(
        kv.action === "noop" ? kv.state.props : kv.props,
        configuration.mcp.oauthKv,
      ),
      "KV configuration is outside this approval",
    );
  }

  // These are fixed metadata queries. No ToDo, user, session or grant rows are read.
  type QueryResult<T> = { success: boolean; results: T[] }[];
  const queryPath = `/accounts/${accountId}/d1/database/${db.databaseId}/query`;
  const columns = await cloudflare<QueryResult<{ name: string }>>(queryPath, {
    sql: 'PRAGMA table_info("__alchemy_migrations")',
  });
  const ledger = await cloudflare<QueryResult<{ name: string; hash: string }>>(queryPath, {
    sql: 'SELECT name, hash FROM "__alchemy_migrations" ORDER BY id',
  });
  check(
    columns.length === 1 && columns[0].success && ledger.length === 1 && ledger[0].success,
    "Migration metadata query failed",
  );
  validateMigrationLedger(
    columns[0].results.map((column) => column.name),
    ledger[0].results,
    hashes,
  );

  type Domain = { hostname: string; service: string };
  const attached = await cloudflare<Domain[]>(
    `/accounts/${accountId}/workers/domains?service=${encodeURIComponent(app.workerName)}`,
  );
  check(
    attached.length === 1 && attached[0].hostname === configuration.worker.domain,
    "Unexpected application custom domains; automatic detachment is not approved",
  );
  if (configuration.mcp) {
    const hostname = configuration.mcp.worker.domain;
    const mcp = nativeResource(snapshot, "Mcp");
    const workerName = mcp.state && "attr" in mcp.state ? mcp.state.attr?.workerName : undefined;
    const domains = await cloudflare<Domain[]>(
      `/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}`,
    );
    check(
      domains.every(
        (domain) => domain.hostname === hostname && workerName && domain.service === workerName,
      ),
      "MCP hostname is already assigned to another Worker",
    );
    if (workerName) {
      const current = await cloudflare<Domain[]>(
        `/accounts/${accountId}/workers/domains?service=${encodeURIComponent(workerName)}`,
      );
      check(
        current.every((domain) => domain.hostname === hostname),
        "Unexpected MCP custom domains; automatic detachment is not approved",
      );
    }
    const zones = await cloudflare<{ id: string; name: string }[]>(
      `/zones?account.id=${accountId}&per_page=50`,
    );
    const zone = zones
      .filter((item) => hostname === item.name || hostname.endsWith(`.${item.name}`))
      .sort((a, b) => b.name.length - a.name.length)[0];
    check(zone, "MCP zone was not found in the deployment account");
    const routes = await cloudflare<{ pattern: string }[]>(`/zones/${zone.id}/workers/routes`);
    check(
      !routes.some((route) => routeMatchesHostname(route.pattern, hostname)),
      "MCP hostname overlaps an existing Worker route",
    );
  }
}

async function main() {
  const planOnly = deploymentPlanOnly(process.env.DEPLOY_PLAN_ONLY);
  const configuration = deploymentResources({
    stage: "production",
    origin: process.env.APP_ORIGIN,
    release: process.env.APP_RELEASE,
    jobs: process.env.JOBS_ENABLED ?? "false",
    maintenance: process.env.MAINTENANCE_MODE ?? "false",
    mcpEnabled: process.env.MCP_ENABLED ?? "false",
    mcpOrigin: process.env.MCP_ORIGIN ?? "",
  });
  check(
    process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_TEMP,
    "Production deployment requires a fresh GitHub Actions runner",
  );
  check(
    process.env.CLOUDFLARE_API_TOKEN &&
      /^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID ?? ""),
    "Missing deployment credentials",
  );
  check(!existsSync(resolve(".alchemy/state")), "Residual local Alchemy state is not approved");
  check(
    !process.env.ALCHEMY_HOME,
    "An existing Alchemy credential home is not approved for this entrypoint",
  );
  process.env.ALCHEMY_HOME = await mkdtemp(join(process.env.RUNNER_TEMP!, "kaji-alchemy-"));
  const hashes = await migrationHashes();
  // Import after selecting the isolated home: SDK modules may capture environment paths.
  const [Alchemy, Effect, References] = await Promise.all([
    import("alchemy/Alchemist"),
    import("effect/Effect"),
    import("effect/References"),
  ]);
  const program = Effect.gen(function* () {
    phase = "plan against the existing state store";
    const snapshot = yield* Alchemy.Stack.plan({
      target: { entrypoint: "alchemy.run.ts", stage: "production" },
      operation: "deploy",
      adopt: false,
      updateStateStore: false,
    });
    phase = "validate resource actions";
    // Only this documented serializable projection is safe for logs.
    console.log(JSON.stringify(deploymentPlanSummary(snapshot)));
    yield* Effect.sync(() => {
      try {
        validateDeploymentPlan(snapshot, Boolean(configuration.mcp));
      } catch (error) {
        recordGuardFailure(error);
      }
    });
    phase = "read-only migration and routing preflight";
    yield* Effect.promise(() =>
      validatePreflight(snapshot, configuration, hashes).catch(recordGuardFailure),
    );
    if (planOnly) {
      console.log("Plan verified; DEPLOY_PLAN_ONLY=true, nothing applied.");
      return;
    }
    phase = "verify unchanged migration files";
    yield* Effect.promise(() =>
      migrationHashes()
        .then((current) =>
          check(isDeepStrictEqual(current, hashes), "Migration files changed after planning"),
        )
        .catch(recordGuardFailure),
    );
    phase = "apply approved snapshot";
    yield* Alchemy.Stack.apply(snapshot);
    console.log("Approved production snapshot applied.");
  });
  const exit = await Effect.runPromiseExit(
    program.pipe(
      Effect.provideService(Alchemy.Progress, (event) =>
        Effect.sync(() => {
          try {
            assertNoBootstrap(event);
            const planningPhase = deploymentPlanningPhase(event);
            if (planningPhase) phase = `plan: ${planningPhase}`;
          } catch (error) {
            recordGuardFailure(error);
          }
        }),
      ),
      Effect.provide(Alchemy.layer()),
      Effect.scoped,
      // Provider warnings can contain raw HTTP bodies. Suppress every SDK Effect logger,
      // including the session file logger; only explicit safe projections above are emitted.
      Effect.provideService(References.MinimumLogLevel, "None"),
    ),
  );
  if (exit._tag === "Failure") {
    console.error(
      JSON.stringify({ event: "deployment_failure", ...safeDeploymentFailure(exit.cause) }),
    );
    throw new DeploymentGuardError("Deployment failed; inspect the safe diagnostic summary.");
  }
}

void main().catch((error: unknown) => {
  if (safeFailure) console.error(safeFailure);
  else if (error instanceof DeploymentGuardError) console.error(error.message);
  console.error(
    `Production deployment stopped during: ${phase}. Raw provider errors are withheld to protect credentials.`,
  );
  process.exitCode = 1;
});
