import type * as P from "./ports";
import type * as M from "../../contracts/models";
import { invariant } from "../domain/errors";

export function task(r: P.GetTaskByIDRow): M.Task {
  invariant(r.Type === "daily" || r.Type === "weekly", "invalid task type");
  return {
    id: r.ID,
    teamId: r.TeamID,
    title: r.Title,
    notes: r.Notes ?? undefined,
    type: r.Type,
    penaltyPoints: r.PenaltyPoints,
    assigneeUserId: r.AssigneeUserID || undefined,
    requiredCompletionsPerWeek: r.RequiredCompletionsPerWeek,
    sortKey: r.SortKey,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
  };
}
export function reminder(r: P.Reminder): M.Reminder {
  invariant(r.Kind === "one_time" || r.Kind === "recurring", "invalid reminder kind");
  invariant(
    r.ScheduleType == null ||
      r.ScheduleType === "daily" ||
      r.ScheduleType === "weekly" ||
      r.ScheduleType === "monthly",
    "invalid reminder schedule",
  );
  return {
    id: r.ID,
    teamId: r.TeamID,
    title: r.Title,
    notes: r.Notes,
    kind: r.Kind,
    scheduleType: r.ScheduleType ?? undefined,
    startDate: r.StartDate,
    endDate: r.EndDate,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
  };
}
export function shopping(r: P.ShoppingItem): M.ShoppingListItem {
  return {
    id: r.ID,
    teamId: r.TeamID,
    name: r.Name,
    notes: r.Notes,
    sortKey: r.SortKey,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
  };
}
export function penalty(r: P.PenaltyRule): M.PenaltyRule {
  return {
    id: r.ID,
    teamId: r.TeamID,
    name: r.Name,
    description: r.Description ?? undefined,
    threshold: r.Threshold,
    deletedAt: r.DeletedAt,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
  };
}
export function actor(r: {
  CompletedByUserID: string | null;
  CompletedByEffectiveName: string;
  CompletedByColorHex: string | null;
}): M.TaskCompletionActor | undefined {
  return r.CompletedByUserID
    ? {
        userId: r.CompletedByUserID,
        effectiveName: r.CompletedByEffectiveName,
        colorHex: r.CompletedByColorHex,
      }
    : undefined;
}
export function slots(
  required: number,
  actors: Map<number, M.TaskCompletionActor | undefined>,
): M.TaskCompletionSlot[] {
  return Array.from({ length: required }, (_, i) => ({ slot: i + 1, actor: actors.get(i + 1) }));
}
export function push(r: P.ListPushSubscriptionsByUserIDRow): M.PushSubscription {
  return {
    id: r.ID,
    teamId: r.TeamID,
    userId: r.UserID,
    endpoint: r.Endpoint,
    platform: "ios_safari_pwa",
    isActive: r.IsActive,
    userAgent: r.UserAgent || null,
    lastSeenAt: r.LastSeenAt,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
  };
}
