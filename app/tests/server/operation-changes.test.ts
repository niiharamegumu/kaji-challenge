import { expect, it } from "vitest";
import { operationChanges } from "../../src/server/application/operation-changes";
import { realtimeMessageSchema } from "../../src/contracts/realtime";

it("classifies every write for notifications and leaves reads without notifications", () => {
  for (const [operation, changes] of Object.entries(operationChanges)) {
    expect(changes.length > 0, operation).toBe(!/^(get|list)/.test(operation));
    expect(realtimeMessageSchema.safeParse({ type: "team-changed", changes }).success).toBe(true);
  }
  expect(operationChanges.postTeamJoin).toEqual(["membership"]);
  expect(operationChanges.postTeamLeave).toEqual(["membership"]);
  expect(operationChanges.postTaskCompletion).toEqual(["task-completions"]);
  expect(operationChanges.deleteTodoItem).toEqual(["todos"]);
});

it("accepts old unscoped messages for rolling deployments and scheduled jobs", () => {
  expect(realtimeMessageSchema.parse({ type: "team-changed" })).toEqual({ type: "team-changed" });
});
