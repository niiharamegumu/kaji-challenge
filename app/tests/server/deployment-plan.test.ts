import type { Stack } from "alchemy/Alchemist";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import { describe, expect, it, vi } from "vitest";
import {
  approvedMigrations,
  assertNoBootstrap,
  deploymentPlanOnly,
  deploymentPlanSummary,
  routeMatchesHostname,
  validateDeploymentPlan,
  validateMigrationFiles,
  validateMigrationLedger,
} from "../../infra/deployment-plan";

type Snapshot = {
  -readonly [K in "stack" | "summary" | "resources" | "actions"]: Stack.PlanSnapshot[K];
};
function plan(): Snapshot {
  return {
    stack: { name: "kaji-challenge", stage: "production" },
    summary: { create: 2, update: 2, noop: 0, delete: 0, replace: 0, adopted: 0, orphaned: 0 },
    actions: [],
    resources: [
      {
        fqn: "Database",
        logicalId: "Database",
        resourceType: "Cloudflare.D1Database",
        action: "update",
        bindings: [],
      },
      {
        fqn: "Application",
        logicalId: "Application",
        resourceType: "Cloudflare.Worker",
        action: "update",
        bindings: [
          { sid: "TEAM_REALTIME", action: "noop" },
          { sid: "OAUTH_KV", action: "create" },
        ],
      },
      {
        fqn: "Mcp",
        logicalId: "Mcp",
        resourceType: "Cloudflare.Worker",
        action: "create",
        bindings: [{ sid: "KAJI_APPLICATION", action: "create" }],
      },
      {
        fqn: "McpOAuthKV",
        logicalId: "McpOAuthKV",
        resourceType: "Cloudflare.KV.Namespace",
        action: "create",
        bindings: [],
      },
    ],
  };
}

describe("production plan approval boundary", () => {
  it("accepts the bounded MCP rollout and a subsequent no-change plan", () => {
    expect(() => validateDeploymentPlan(plan(), true)).not.toThrow();
    const repeat = plan();
    repeat.resources = repeat.resources.map((resource) => ({ ...resource, action: "noop" }));
    repeat.summary = {
      create: 0,
      update: 0,
      noop: 4,
      delete: 0,
      replace: 0,
      adopted: 0,
      orphaned: 0,
    };
    expect(() => validateDeploymentPlan(repeat, true)).not.toThrow();
  });
  it("keeps the original two resources when no MCP origin is configured", () => {
    const original = plan();
    original.resources = original.resources.slice(0, 2);
    original.summary = { ...original.summary, create: 0 };
    expect(() => validateDeploymentPlan(original, false)).not.toThrow();
    expect(() => validateDeploymentPlan(original, true)).toThrow("resource count");
  });
  it.each(["delete", "replace", "adopted", "orphaned"] as const)(
    "rejects %s even on the retained KV resource",
    (action) => {
      const snapshot = plan();
      snapshot.resources = snapshot.resources.map((resource) =>
        resource.logicalId === "McpOAuthKV" ? { ...resource, action } : resource,
      );
      expect(() => validateDeploymentPlan(snapshot, true)).toThrow("Resource action");
    },
  );
  it.each(["Database", "Application"])("does not recreate missing existing %s", (id) => {
    const snapshot = plan();
    snapshot.resources = snapshot.resources.map((resource) =>
      resource.logicalId === id ? { ...resource, action: "create" } : resource,
    );
    expect(() => validateDeploymentPlan(snapshot, true)).toThrow("Resource action");
  });
  it.each([
    ["namespace change", { fqn: "Other/Mcp" }],
    ["unexpected resource", { logicalId: "Billing" }],
    ["wrong type", { resourceType: "Cloudflare.R2.Bucket" }],
    ["local provider", { providerMode: "local" }],
    ["mode switch", { fromProviderMode: "local" }],
    ["binding deletion", { bindings: [{ sid: "KAJI_APPLICATION", action: "delete" }] }],
    ["secret or DB binding on MCP", { bindings: [{ sid: "DB", action: "create" }] }],
  ])("rejects %s", (_label, change) => {
    const snapshot = plan();
    snapshot.resources = snapshot.resources.map((resource) =>
      resource.logicalId === "Mcp" ? ({ ...resource, ...change } as typeof resource) : resource,
    );
    expect(() => validateDeploymentPlan(snapshot, true)).toThrow();
  });
  it("rejects arbitrary stack actions, summary inconsistencies, and wrong stages", () => {
    expect(() =>
      validateDeploymentPlan(
        {
          ...plan(),
          actions: [{ fqn: "Task", logicalId: "Task", actionType: "Shell", action: "run" }],
        },
        true,
      ),
    ).toThrow("Stack actions");
    expect(() =>
      validateDeploymentPlan({ ...plan(), summary: { ...plan().summary, create: 99 } }, true),
    ).toThrow("summary");
    expect(() =>
      validateDeploymentPlan(
        { ...plan(), stack: { name: "kaji-challenge", stage: "staging" } },
        true,
      ),
    ).toThrow("stage");
  });
  it("defaults to applying but only accepts explicit boolean plan-only settings", () => {
    expect(deploymentPlanOnly(undefined)).toBe(false);
    expect(deploymentPlanOnly("false")).toBe(false);
    expect(deploymentPlanOnly("true")).toBe(true);
    expect(() => deploymentPlanOnly("yes")).toThrow();
    expect(() => deploymentPlanOnly("")).toThrow();
  });
  it("logs only the safe projection even if SDK rows acquire additional fields", () => {
    const snapshot = plan();
    Object.assign(snapshot, {
      native: { secret: "private-value" },
      session: { token: "private-value" },
    });
    Object.assign(snapshot.resources[0], { props: { secret: "private-value" } });
    Object.assign(snapshot.resources[1].bindings[0], { data: { value: "private-value" } });
    expect(JSON.stringify(deploymentPlanSummary(snapshot))).not.toContain("private-value");
  });
  it("suppresses provider warning bodies even when a session adds its own logger", async () => {
    const write = vi.fn();
    await Effect.runPromise(
      Effect.logWarning("private provider response").pipe(
        Effect.provide(Logger.layer([Logger.make(write)], { mergeWithExisting: true })),
        Effect.provideService(References.MinimumLogLevel, "None"),
      ),
    );
    expect(write).not.toHaveBeenCalled();
  });
  it("aborts at the public bootstrap-start event before its operation runs", async () => {
    const bootstrap = vi.fn();
    await expect(
      Effect.runPromise(
        Effect.sync(() => assertNoBootstrap({ _tag: "state.bootstrap.started" })).pipe(
          Effect.andThen(Effect.sync(bootstrap)),
        ),
      ),
    ).rejects.toThrow("not approved");
    expect(bootstrap).not.toHaveBeenCalled();
    expect(() => assertNoBootstrap({ _tag: "plan.phase" })).not.toThrow();
  });
});

describe("migration approval boundary", () => {
  const hashes = Object.fromEntries(
    approvedMigrations.map((name, index) => [name, `hash-${index}`]),
  );
  const columns = ["id", "hash", "created_at", "name", "applied_at"];
  const rows = approvedMigrations.map((name) => ({ name, hash: hashes[name] }));
  it("allows only 0008 to be pending, and accepts the same release after it is applied", () => {
    expect(() => validateMigrationLedger(columns, rows.slice(0, 7), hashes)).not.toThrow();
    expect(() => validateMigrationLedger(columns, rows, hashes)).not.toThrow();
  });
  it("rejects missing old migrations, changed history, unexpected files and legacy conversion", () => {
    expect(() => validateMigrationLedger(columns, rows.slice(0, 6), hashes)).toThrow("history");
    expect(() =>
      validateMigrationLedger(columns, [rows[1], rows[0], ...rows.slice(2)], hashes),
    ).toThrow("historical");
    expect(() =>
      validateMigrationLedger(columns, [{ ...rows[0], hash: "changed" }, ...rows.slice(1)], hashes),
    ).toThrow("historical");
    expect(() => validateMigrationFiles({ ...hashes, "nested/other.sql": "hash" })).toThrow(
      "files",
    );
    expect(() => validateMigrationLedger(["id", "name", "applied_at"], rows, hashes)).toThrow(
      "conversion",
    );
  });
});

describe("Worker route overlap", () => {
  it.each(["*.megumu.me/*", "https://kaji-mcp.megumu.me/*", "kaji-mcp.megumu.me/path*"])(
    "recognizes %s",
    (pattern) => {
      expect(routeMatchesHostname(pattern, "kaji-mcp.megumu.me")).toBe(true);
    },
  );
  it("does not confuse other hosts or treat dots as wildcards", () => {
    expect(routeMatchesHostname("kaji.megumu.me/*", "kaji-mcp.megumu.me")).toBe(false);
    expect(routeMatchesHostname("kaji-mcp.megumu.me/*", "kaji-mcpXmegumuXme")).toBe(false);
  });
});
