import type { Stack } from "alchemy/Alchemist";

export class DeploymentGuardError extends Error {}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new DeploymentGuardError(message);
}

export function deploymentPlanOnly(value: string | undefined) {
  requireCondition(
    value === undefined || value === "true" || value === "false",
    "Invalid DEPLOY_PLAN_ONLY",
  );
  return value === "true";
}

const resources = {
  Database: "Cloudflare.D1Database",
  Application: "Cloudflare.Worker",
  Mcp: "Cloudflare.Worker",
  McpOAuthKV: "Cloudflare.KV.Namespace",
} as const;
const applicationBindings = new Set([
  "DB",
  "TEAM_REALTIME",
  "APP_ORIGIN",
  "APP_RELEASE",
  "JOBS_ENABLED",
  "MAINTENANCE_MODE",
  "MCP_ENABLED",
  "MCP_ORIGIN",
  "OAUTH_KV",
  "SIGNUP_ALLOWED_EMAILS",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
]);
const mcpBindings = new Set([
  "KAJI_APPLICATION",
  "APP_ORIGIN",
  "APP_RELEASE",
  "MCP_ENABLED",
  "MCP_ORIGIN",
  "MAINTENANCE_MODE",
]);

export function deploymentPlanSummary(
  snapshot: Pick<Stack.PlanSnapshot, "stack" | "summary" | "resources" | "actions">,
) {
  return {
    stack: { name: snapshot.stack.name, stage: snapshot.stack.stage },
    summary: {
      create: snapshot.summary.create,
      update: snapshot.summary.update,
      noop: snapshot.summary.noop,
      delete: snapshot.summary.delete,
      replace: snapshot.summary.replace,
      adopted: snapshot.summary.adopted,
      orphaned: snapshot.summary.orphaned,
    },
    resources: snapshot.resources.map((resource) => ({
      fqn: resource.fqn,
      logicalId: resource.logicalId,
      resourceType: resource.resourceType,
      action: resource.action,
      providerMode: resource.providerMode,
      fromProviderMode: resource.fromProviderMode,
      bindings: resource.bindings.map((binding) => ({ sid: binding.sid, action: binding.action })),
    })),
    actions: snapshot.actions.map((action) => ({
      fqn: action.fqn,
      logicalId: action.logicalId,
      actionType: action.actionType,
      action: action.action,
    })),
  };
}

/** This is a bounded rollout policy. A later infrastructure/migration change needs a reviewed update. */
export function validateDeploymentPlan(
  snapshot: Pick<Stack.PlanSnapshot, "stack" | "summary" | "resources" | "actions">,
  mcpConfigured: boolean,
) {
  requireCondition(
    snapshot.stack.name === "kaji-challenge" && snapshot.stack.stage === "production",
    "Unexpected stack or stage",
  );
  requireCondition(
    snapshot.actions.length === 0,
    "Stack actions are outside this deployment approval",
  );
  const expected = mcpConfigured ? Object.keys(resources) : ["Database", "Application"];
  requireCondition(snapshot.resources.length === expected.length, "Unexpected resource count");
  const seen = new Set<string>();
  const counts = { create: 0, update: 0, noop: 0 };
  for (const resource of snapshot.resources) {
    const id = resource.logicalId;
    requireCondition(
      expected.includes(id) && !seen.has(id) && resource.fqn === id,
      "Unexpected resource identity",
    );
    seen.add(id);
    requireCondition(
      resource.resourceType === resources[id as keyof typeof resources],
      "Unexpected resource type",
    );
    requireCondition(
      resource.providerMode !== "local" && resource.fromProviderMode === undefined,
      "Unexpected provider mode",
    );
    const action = resource.action;
    requireCondition(
      action === "noop" ||
        action === "update" ||
        (action === "create" && (id === "Mcp" || id === "McpOAuthKV")),
      "Resource action is outside this deployment approval",
    );
    counts[action]++;
    const allowed =
      id === "Application" ? applicationBindings : id === "Mcp" ? mcpBindings : new Set<string>();
    const seenBindings = new Set<string>();
    for (const binding of resource.bindings) {
      requireCondition(
        allowed.has(binding.sid) && !seenBindings.has(binding.sid),
        "Unexpected resource binding",
      );
      seenBindings.add(binding.sid);
      requireCondition(
        binding.action === "create" || binding.action === "update" || binding.action === "noop",
        "Binding removal is outside this deployment approval",
      );
    }
  }
  requireCondition(
    snapshot.summary.create === counts.create &&
      snapshot.summary.update === counts.update &&
      snapshot.summary.noop === counts.noop &&
      snapshot.summary.delete === 0 &&
      snapshot.summary.replace === 0 &&
      snapshot.summary.adopted === 0 &&
      snapshot.summary.orphaned === 0,
    "Unexpected plan summary",
  );
}

export const approvedMigrations = [
  "0001_initial.sql",
  "0002_unify_users.sql",
  "0003_iso_timestamps.sql",
  "0004_remove_revisions.sql",
  "0005_todos.sql",
  "0006_todo_category_order.sql",
  "0007_todo_category_ids.sql",
  "0008_mcp_connections.sql",
] as const;

export function validateMigrationFiles(hashes: Record<string, string>) {
  requireCondition(
    Object.keys(hashes).sort().join("\n") === [...approvedMigrations].sort().join("\n"),
    "Unexpected migration files",
  );
}

/** Only canonical Alchemy bookkeeping is accepted; no legacy-table conversion or old migration replay. */
export function validateMigrationLedger(
  columns: readonly string[],
  rows: readonly { name: string; hash: string }[],
  hashes: Record<string, string>,
) {
  validateMigrationFiles(hashes);
  requireCondition(
    ["id", "hash", "created_at", "name", "applied_at"].every((column) => columns.includes(column)),
    "Migration ledger needs an unapproved conversion",
  );
  requireCondition(rows.length === 7 || rows.length === 8, "Unexpected migration history");
  for (const [index, row] of rows.entries()) {
    requireCondition(
      row.name === approvedMigrations[index] && row.hash === hashes[row.name],
      "Missing or changed historical migration",
    );
  }
}

export function assertNoBootstrap(event: { _tag: string }) {
  requireCondition(
    event._tag !== "state.bootstrap.started",
    "State-store bootstrap or upgrade is not approved",
  );
}

export function routeMatchesHostname(pattern: string, hostname: string) {
  const host = pattern.replace(/^https?:\/\//, "").split("/")[0];
  const expression = host
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`, "i").test(hostname);
}
