import type { z } from "zod";
import type * as Schemas from "./operations";
import {
  PushPlatformSchema,
  TaskTypeSchema,
  ReminderKindSchema,
  ReminderScheduleTypeSchema,
} from "./operations";

// DTOs and enum values share the runtime schemas as their source of truth.
export type User = z.infer<typeof Schemas.UserSchema>;
export type MeResponse = z.infer<typeof Schemas.MeResponseSchema>;
export type CreateInviteRequest = z.infer<typeof Schemas.CreateInviteRequestSchema>;
export type InviteCodeResponse = z.infer<typeof Schemas.InviteCodeResponseSchema>;
export type JoinTeamRequest = z.infer<typeof Schemas.JoinTeamRequestSchema>;
export type JoinTeamResponse = z.infer<typeof Schemas.JoinTeamResponseSchema>;
export type UpdateCurrentTeamRequest = z.infer<typeof Schemas.UpdateCurrentTeamRequestSchema>;
export type TeamInfoResponse = z.infer<typeof Schemas.TeamInfoResponseSchema>;
export type TeamMember = z.infer<typeof Schemas.TeamMemberSchema>;
export type TeamMembersResponse = z.infer<typeof Schemas.TeamMembersResponseSchema>;
export type UpdateNicknameRequest = z.infer<typeof Schemas.UpdateNicknameRequestSchema>;
export type UpdateNicknameResponse = z.infer<typeof Schemas.UpdateNicknameResponseSchema>;
export type UpdateColorRequest = z.infer<typeof Schemas.UpdateColorRequestSchema>;
export type UpdateColorResponse = z.infer<typeof Schemas.UpdateColorResponseSchema>;
export type PushPlatform = z.infer<typeof Schemas.PushPlatformSchema>;
export type PushSubscription = z.infer<typeof Schemas.PushSubscriptionSchema>;
export type UpsertPushSubscriptionRequest = z.infer<
  typeof Schemas.UpsertPushSubscriptionRequestSchema
>;
export type ListPushSubscriptionsResponse = z.infer<
  typeof Schemas.ListPushSubscriptionsResponseSchema
>;
export type TaskType = z.infer<typeof Schemas.TaskTypeSchema>;
export type ReminderKind = z.infer<typeof Schemas.ReminderKindSchema>;
export type ReminderScheduleType = z.infer<typeof Schemas.ReminderScheduleTypeSchema>;
export type Reminder = z.infer<typeof Schemas.ReminderSchema>;
export type CreateReminderRequest = z.infer<typeof Schemas.CreateReminderRequestSchema>;
export type UpdateReminderRequest = z.infer<typeof Schemas.UpdateReminderRequestSchema>;
export type ReminderOccurrence = z.infer<typeof Schemas.ReminderOccurrenceSchema>;
export type ReminderCalendarResponse = z.infer<typeof Schemas.ReminderCalendarResponseSchema>;
export type ReminderListResponse = z.infer<typeof Schemas.ReminderListResponseSchema>;
export type Task = z.infer<typeof Schemas.TaskSchema>;
export type CreateTaskRequest = z.infer<typeof Schemas.CreateTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof Schemas.UpdateTaskRequestSchema>;
export type ReorderTasksRequest = z.infer<typeof Schemas.ReorderTasksRequestSchema>;
export type ToggleTaskCompletionRequest = z.infer<typeof Schemas.ToggleTaskCompletionRequestSchema>;
export type TaskCompletionResponse = z.infer<typeof Schemas.TaskCompletionResponseSchema>;
export type TaskCompletionActor = z.infer<typeof Schemas.TaskCompletionActorSchema>;
export type TaskCompletionSlot = z.infer<typeof Schemas.TaskCompletionSlotSchema>;
export type PenaltyRule = z.infer<typeof Schemas.PenaltyRuleSchema>;
export type CreatePenaltyRuleRequest = z.infer<typeof Schemas.CreatePenaltyRuleRequestSchema>;
export type UpdatePenaltyRuleRequest = z.infer<typeof Schemas.UpdatePenaltyRuleRequestSchema>;
export type ShoppingListItem = z.infer<typeof Schemas.ShoppingListItemSchema>;
export type CreateShoppingListItemRequest = z.infer<
  typeof Schemas.CreateShoppingListItemRequestSchema
>;
export type UpdateShoppingListItemRequest = z.infer<
  typeof Schemas.UpdateShoppingListItemRequestSchema
>;
export type ReorderShoppingListItemsRequest = z.infer<
  typeof Schemas.ReorderShoppingListItemsRequestSchema
>;
export type TaskOverviewDailyTask = z.infer<typeof Schemas.TaskOverviewDailyTaskSchema>;
export type TaskOverviewWeeklyTask = z.infer<typeof Schemas.TaskOverviewWeeklyTaskSchema>;
export type TaskOverviewResponse = z.infer<typeof Schemas.TaskOverviewResponseSchema>;
export type MonthlyTaskStatusItem = z.infer<typeof Schemas.MonthlyTaskStatusItemSchema>;
export type MonthlyTaskStatusGroup = z.infer<typeof Schemas.MonthlyTaskStatusGroupSchema>;
export type MonthlyPenaltySummary = z.infer<typeof Schemas.MonthlyPenaltySummarySchema>;
export type CloseResponse = z.infer<typeof Schemas.CloseResponseSchema>;
export type MonthCloseCandidateResponse = z.infer<typeof Schemas.MonthCloseCandidateResponseSchema>;

export const PushPlatform = PushPlatformSchema.enum;
export const TaskType = TaskTypeSchema.enum;
export const ReminderKind = ReminderKindSchema.enum;
export const ReminderScheduleType = ReminderScheduleTypeSchema.enum;
