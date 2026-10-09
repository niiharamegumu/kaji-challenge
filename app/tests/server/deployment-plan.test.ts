import type { Stack } from "alchemy/Alchemist";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import { describe, expect, it, vi } from "vitest";
import {
  approvedMigrations,
  assertNoBootstrap,
  deploymentPlanOnly,
  deploymentPlanningPhase,
  deploymentPlanSummary,
  routeMatchesHostname,
  safeDeploymentFailure,
  validateDeploymentPlan,
  validateMigrationFiles,
  validateMigrationLedger,
  validateWorkerPlanProps,
} from "../../infra/deployment-plan";

type Snapshot = {
  -readonly [K in "stack" | "summary" | "resources" | "actions"]: Stack.PlanSnapshot[K];
};

describe("safe deployment failure diagnostics", () => {
  it("classifies preview failures without disclosing response bodies or credentials", () => {
    const failure = {
      reasons: [
        {
          _tag: "Fail",
          error: {
            _tag: "EdgeSessionError",
            message: "Secret probe returned 403: private-token-value",
            cause: { _tag: "Forbidden", status: 403, body: "private-token-value" },
          },
        },
      ],
    };
    expect(safeDeploymentFailure(failure)).toEqual({
      tags: ["EdgeSessionError", "Forbidden"],
      classifications: ["preview_probe_http_failure"],
      statuses: [403],
      codes: [],
    });
    expect(JSON.stringify(safeDeploymentFailure(failure))).not.toContain("private-token-value");
  });
  it("reports only known SDK authentication classifications", () => {
    expect(
      safeDeploymentFailure({
        _tag: "AuthError",
        message: "Cloudflare State store not found. Run arbitrary-private-suffix",
      }).classifications,
    ).toEqual(["state_store_unavailable"]);
    expect(
      safeDeploymentFailure({
        _tag: "private-token-value",
        message: "private-token-value",
        status: 403,
        code: 10000,
      }),
    ).toEqual({ tags: [], classifications: [], statuses: [], codes: [] });
  });
  it("keeps safe API codes while ignoring request, headers, annotations and getters", () => {
    const failure = {
      _tag: "CloudflareHttpError",
      code: 10000,
      status: 403,
      request: { _tag: "Forbidden" },
      annotations: { _tag: "Unauthorized" },
      get cause() {
        throw new Error("must not evaluate getters");
      },
    };
    expect(safeDeploymentFailure(failure)).toEqual({
      tags: ["CloudflareHttpError"],
      classifications: [],
      statuses: [403],
      codes: [10000],
    });
  });
  it.each([
    HttpClientError.StatusCodeError,
    HttpClientError.DecodeError,
    HttpClientError.EmptyBodyError,
  ])("reads the HTTP status from a real Effect response (%#)", (ResponseError) => {
    const request = HttpClientRequest.get("https://example.invalid/private-token-value");
    const response = HttpClientResponse.fromWeb(
      request,
      new Response("private-token-value", {
        status: 403,
        headers: { "x-private": "private-token-value" },
      }),
    );
    class PreviewError extends Data.TaggedError("EdgeSessionError")<{
      message: string;
      cause: unknown;
    }> {}
    const failure = Cause.fail(
      new PreviewError({
        message: "Failed to read secret",
        cause: new HttpClientError.HttpClientError({
          reason: new ResponseError({ request, response }),
        }),
      }),
    );
    const diagnostic = safeDeploymentFailure(failure);
    expect(diagnostic.statuses).toEqual([403]);
    expect(diagnostic.tags).toContain(new ResponseError({ request, response })._tag);
    expect(diagnostic.classifications).toEqual(["preview_secret_read_failed"]);
    expect(JSON.stringify(diagnostic)).not.toContain("private-token-value");
  });
  it("uses the captured native getter without reading response overrides, body or headers", () => {
    const getter = vi.fn(() => {
      throw new Error("must not evaluate arbitrary response getters");
    });
    const request = HttpClientRequest.get("https://example.invalid");
    const source = new Response("private-token-value", { status: 502 });
    const response = HttpClientResponse.fromWeb(request, source);
    for (const key of ["status", "body", "headers"]) {
      Object.defineProperty(source, key, { get: getter });
      Object.defineProperty(response, key, { get: getter });
    }
    expect(
      safeDeploymentFailure(new HttpClientError.StatusCodeError({ request, response })).statuses,
    ).toEqual([502]);
    expect(getter).not.toHaveBeenCalled();
  });
  it("rejects response impostors and does not evaluate a source getter", () => {
    const getter = vi.fn(() => {
      throw new Error("must not evaluate arbitrary response getters");
    });
    for (const response of [
      { source: Object.create(Response.prototype) },
      {
        source: {
          get status() {
            return getter();
          },
        },
      },
      {
        get source() {
          return getter();
        },
      },
    ]) {
      expect(safeDeploymentFailure({ _tag: "StatusCodeError", response }).statuses).toEqual([]);
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it("bounds cyclic or large cause trees", () => {
    const failure: { _tag: string; cause?: unknown } = { _tag: "TimeoutError" };
    failure.cause = failure;
    expect(safeDeploymentFailure(failure).tags).toEqual(["TimeoutError"]);
    expect(
      safeDeploymentFailure({ reasons: Array.from({ length: 100 }, () => failure) }).tags,
    ).toEqual(["TimeoutError"]);
  });
  it("exposes only the fixed planning phases", () => {
    expect(deploymentPlanningPhase({ _tag: "plan.phase", phase: "loading-state" })).toBe(
      "loading-state",
    );
    expect(
      deploymentPlanningPhase({ _tag: "plan.phase", phase: "private-token-value" }),
    ).toBeUndefined();
    expect(
      deploymentPlanningPhase({ _tag: "different-event", phase: "loading-state" }),
    ).toBeUndefined();
  });
});
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
  it("accepts only the SDK external Worker marker and the exact approved properties", () => {
    const expected = { main: "dist/mcp/index.js", bundle: false, workersDev: false };
    expect(() =>
      validateWorkerPlanProps({ ...expected, env: {}, isExternal: true }, expected),
    ).not.toThrow();
    for (const isExternal of [undefined, false, "true"]) {
      expect(() => validateWorkerPlanProps({ ...expected, isExternal }, expected)).toThrow(
        "runtime mode",
      );
    }
    expect(() =>
      validateWorkerPlanProps({ ...expected, isExternal: true, workersDev: true }, expected),
    ).toThrow("outside this approval");
    expect(() =>
      validateWorkerPlanProps({ ...expected, isExternal: true, unexpected: true }, expected),
    ).toThrow("outside this approval");
  });
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
