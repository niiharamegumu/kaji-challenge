import { callOperation, type ApiResult, type CallOptions } from "./serverClient";
import type * as M from "../../contracts/models";
export * from "../../contracts/models";
export function getMe(options?: CallOptions): Promise<ApiResult<M.MeResponse>> {
  return callOperation("getMe", { params: {} }, 200, false, options);
}
export function patchMeNickname(
  body: M.UpdateNicknameRequest,
  options?: CallOptions,
): Promise<ApiResult<M.UpdateNicknameResponse>> {
  return callOperation("patchMeNickname", { params: {}, body }, 200, true, options);
}
export function patchMeColor(
  body: M.UpdateColorRequest,
  options?: CallOptions,
): Promise<ApiResult<M.UpdateColorResponse>> {
  return callOperation("patchMeColor", { params: {}, body }, 200, true, options);
}
export function postPushSubscription(
  body: M.UpsertPushSubscriptionRequest,
  options?: CallOptions,
): Promise<ApiResult<M.PushSubscription>> {
  return callOperation("postPushSubscription", { params: {}, body }, 200, false, options);
}
export function deletePushSubscription(
  subscriptionId: string,
  options?: CallOptions,
): Promise<ApiResult<Record<string, never>>> {
  return callOperation(
    "deletePushSubscription",
    { params: { subscriptionId } },
    204,
    false,
    options,
  );
}
export function getPushSubscriptionsMe(
  options?: CallOptions,
): Promise<ApiResult<M.ListPushSubscriptionsResponse>> {
  return callOperation("getPushSubscriptionsMe", { params: {} }, 200, false, options);
}
export function postTeamInvite(
  body: M.CreateInviteRequest,
  options?: CallOptions,
): Promise<ApiResult<M.InviteCodeResponse>> {
  return callOperation("postTeamInvite", { params: {}, body }, 201, true, options);
}
export function getTeamCurrentInvite(
  options?: CallOptions,
): Promise<ApiResult<M.InviteCodeResponse>> {
  return callOperation("getTeamCurrentInvite", { params: {} }, 200, false, options);
}
export function patchTeamCurrent(
  body: M.UpdateCurrentTeamRequest,
  options?: CallOptions,
): Promise<ApiResult<M.TeamInfoResponse>> {
  return callOperation("patchTeamCurrent", { params: {}, body }, 200, true, options);
}
export function getTeamCurrentMembers(
  options?: CallOptions,
): Promise<ApiResult<M.TeamMembersResponse>> {
  return callOperation("getTeamCurrentMembers", { params: {} }, 200, false, options);
}
export function postTeamJoin(
  body: M.JoinTeamRequest,
  options?: CallOptions,
): Promise<ApiResult<M.JoinTeamResponse>> {
  return callOperation("postTeamJoin", { params: {}, body }, 200, true, options);
}
export function postTeamLeave(options?: CallOptions): Promise<ApiResult<M.JoinTeamResponse>> {
  return callOperation("postTeamLeave", { params: {} }, 200, true, options);
}
export function listTasks(
  params?: { type?: string },
  options?: CallOptions,
): Promise<ApiResult<{ items: M.Task[] }>> {
  return callOperation("listTasks", { params: { ...params } }, 200, false, options);
}
export function postTask(
  body: M.CreateTaskRequest,
  options?: CallOptions,
): Promise<ApiResult<M.Task>> {
  return callOperation("postTask", { params: {}, body }, 201, true, options);
}
export function postTasksReorder(
  body: M.ReorderTasksRequest,
  options?: CallOptions,
): Promise<ApiResult<{ items: M.Task[] }>> {
  return callOperation("postTasksReorder", { params: {}, body }, 200, true, options);
}
export function patchTask(
  taskId: string,
  body: M.UpdateTaskRequest,
  options?: CallOptions,
): Promise<ApiResult<M.Task>> {
  return callOperation("patchTask", { params: { taskId }, body }, 200, true, options);
}
export function deleteTask(
  taskId: string,
  options?: CallOptions,
): Promise<ApiResult<Record<string, never>>> {
  return callOperation("deleteTask", { params: { taskId } }, 204, true, options);
}
export function postTaskCompletionToggle(
  taskId: string,
  body: M.ToggleTaskCompletionRequest,
  options?: CallOptions,
): Promise<ApiResult<M.TaskCompletionResponse>> {
  return callOperation(
    "postTaskCompletionToggle",
    { params: { taskId }, body },
    200,
    true,
    options,
  );
}
export function listReminders(
  params: { from: string; to: string },
  options?: CallOptions,
): Promise<ApiResult<M.ReminderCalendarResponse>> {
  return callOperation("listReminders", { params: { ...params } }, 200, false, options);
}
export function postReminder(
  body: M.CreateReminderRequest,
  options?: CallOptions,
): Promise<ApiResult<M.Reminder>> {
  return callOperation("postReminder", { params: {}, body }, 201, true, options);
}
export function listReminderDefinitions(
  options?: CallOptions,
): Promise<ApiResult<M.ReminderListResponse>> {
  return callOperation("listReminderDefinitions", { params: {} }, 200, false, options);
}
export function patchReminder(
  reminderId: string,
  body: M.UpdateReminderRequest,
  options?: CallOptions,
): Promise<ApiResult<M.Reminder>> {
  return callOperation("patchReminder", { params: { reminderId }, body }, 200, true, options);
}
export function deleteReminder(
  reminderId: string,
  options?: CallOptions,
): Promise<ApiResult<Record<string, never>>> {
  return callOperation("deleteReminder", { params: { reminderId } }, 204, true, options);
}
export function listPenaltyRules(
  params?: { includeDeleted?: boolean },
  options?: CallOptions,
): Promise<ApiResult<{ items: M.PenaltyRule[] }>> {
  return callOperation("listPenaltyRules", { params: { ...params } }, 200, false, options);
}
export function postPenaltyRule(
  body: M.CreatePenaltyRuleRequest,
  options?: CallOptions,
): Promise<ApiResult<M.PenaltyRule>> {
  return callOperation("postPenaltyRule", { params: {}, body }, 201, true, options);
}
export function patchPenaltyRule(
  ruleId: string,
  body: M.UpdatePenaltyRuleRequest,
  options?: CallOptions,
): Promise<ApiResult<M.PenaltyRule>> {
  return callOperation("patchPenaltyRule", { params: { ruleId }, body }, 200, true, options);
}
export function deletePenaltyRule(
  ruleId: string,
  options?: CallOptions,
): Promise<ApiResult<Record<string, never>>> {
  return callOperation("deletePenaltyRule", { params: { ruleId } }, 204, true, options);
}
export function listShoppingItems(
  options?: CallOptions,
): Promise<ApiResult<{ items: M.ShoppingListItem[] }>> {
  return callOperation("listShoppingItems", { params: {} }, 200, false, options);
}
export function postShoppingItem(
  body: M.CreateShoppingListItemRequest,
  options?: CallOptions,
): Promise<ApiResult<M.ShoppingListItem>> {
  return callOperation("postShoppingItem", { params: {}, body }, 201, true, options);
}
export function patchShoppingItem(
  itemId: string,
  body: M.UpdateShoppingListItemRequest,
  options?: CallOptions,
): Promise<ApiResult<M.ShoppingListItem>> {
  return callOperation("patchShoppingItem", { params: { itemId }, body }, 200, true, options);
}
export function deleteShoppingItem(
  itemId: string,
  options?: CallOptions,
): Promise<ApiResult<Record<string, never>>> {
  return callOperation("deleteShoppingItem", { params: { itemId } }, 204, true, options);
}
export function postShoppingItemsReorder(
  body: M.ReorderShoppingListItemsRequest,
  options?: CallOptions,
): Promise<ApiResult<{ items: M.ShoppingListItem[] }>> {
  return callOperation("postShoppingItemsReorder", { params: {}, body }, 200, true, options);
}
export function getTaskOverview(options?: CallOptions): Promise<ApiResult<M.TaskOverviewResponse>> {
  return callOperation("getTaskOverview", { params: {} }, 200, false, options);
}
export function getPenaltySummaryMonthly(
  params?: { month?: string },
  options?: CallOptions,
): Promise<ApiResult<M.MonthlyPenaltySummary>> {
  return callOperation("getPenaltySummaryMonthly", { params: { ...params } }, 200, false, options);
}
export function getMonthCloseCandidate(
  options?: CallOptions,
): Promise<ApiResult<M.MonthCloseCandidateResponse>> {
  return callOperation("getMonthCloseCandidate", { params: {} }, 200, false, options);
}
export function postMonthClose(
  month: string,
  options?: CallOptions,
): Promise<ApiResult<M.CloseResponse>> {
  return callOperation("postMonthClose", { params: { month } }, 200, true, options);
}
