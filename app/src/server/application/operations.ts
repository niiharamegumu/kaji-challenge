import type { Operation } from "../../contracts/operations";
import type { Repository } from "./ports";
import { invariant } from "../domain/errors";
import { addDays, midnightJST, todayJST, weekStart } from "../domain/dates";
import {
  completionCount,
  effectiveAt,
  effectiveName,
  ownTeamName,
  validateReorder,
  validateReminder,
} from "../domain/rules";
import * as map from "./mappers";
import {
  closeMonth,
  monthCandidate,
  monthlySummary,
  overview,
  reminderOccurrences,
} from "./summary";

export interface OperationContext {
  userId: string;
  now: Date;
  vapidPublicKey: string;
}
const readOperations = new Set<Operation["operation"]>([
  "getMe",
  "getPushSubscriptionsMe",
  "getTeamCurrentInvite",
  "getTeamCurrentMembers",
  "listTasks",
  "listReminders",
  "listReminderDefinitions",
  "listPenaltyRules",
  "listShoppingItems",
  "getTaskOverview",
  "getPenaltySummaryMonthly",
  "getMonthCloseCandidate",
]);
export function isTeamMutation(operation: Operation["operation"]) {
  return !readOperations.has(operation);
}
const requiredText = (value: string) => {
  const text = value.trim();
  invariant(text, "value cannot be empty");
  return text;
};
async function membership(repo: Repository, userId: string) {
  const rows = await repo.ListMembershipsByUserID(userId);
  invariant(rows[0], "user has no team membership", 403);
  return rows[0];
}

export async function executeOperation(
  repository: Repository,
  input: Operation,
  context: OperationContext,
): Promise<{ data: unknown; changedTeams: string[] }> {
  let member = await membership(repository, context.userId);

  let didChange = true;
  const teamId = member.TeamID;
  const userId = context.userId;
  const now = context.now.toISOString();
  const today = todayJST(context.now);
  const repo = repository.forMember(teamId, userId);
  let data: unknown;
  switch (input.operation) {
    case "getMe": {
      const user = await repo.GetUserByID(userId);
      data = {
        user: {
          id: user.ID,
          email: user.Email,
          displayName: user.DisplayName,
          colorHex: user.ColorHex,
          createdAt: user.CreatedAt,
        },
        memberships: [{ teamId, role: member.Role, teamName: member.TeamName }],
      };
      break;
    }
    case "patchMeNickname": {
      const nickname = input.body.nickname.trim();
      invariant(Array.from(nickname).length <= 30, "nickname must be 30 characters or fewer");
      await repo.UpdateUserNickname({ ID: userId, Nickname: nickname });
      const user = await repo.GetUserByID(userId);
      data = { nickname, effectiveName: effectiveName(user.DisplayName, nickname) };
      break;
    }
    case "patchMeColor": {
      const color = input.body.colorHex?.trim().toUpperCase() || null;
      invariant(!color || /^#[0-9A-F]{6}$/.test(color), "invalid color");
      await repo.UpdateUserColorHex({ ID: userId, ColorHex: color ?? "" });
      data = { colorHex: color };
      break;
    }
    case "getTeamCurrentMembers":
      data = {
        items: (await repo.ListTeamMembersByTeamID(teamId)).map((teamMember) => ({
          userId: teamMember.UserID,
          displayName: teamMember.DisplayName,
          nickname: teamMember.Nickname || null,
          effectiveName: effectiveName(teamMember.DisplayName, teamMember.Nickname),
          colorHex: teamMember.ColorHex,
          role: teamMember.Role,
          joinedAt: teamMember.CreatedAt,
        })),
      };
      break;
    case "patchTeamCurrent": {
      const name = requiredText(input.body.name);
      invariant(Array.from(name).length <= 50, "team name must be 50 characters or fewer");
      await repo.UpdateTeamName({ ID: teamId, Name: name });
      data = { teamId, name };
      break;
    }
    case "postTeamInvite": {
      invariant(member.Role === "owner", "owner role required", 403);
      const code = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
      const expiresAt = new Date(
        context.now.getTime() + (input.body.expiresInHours ?? 72) * 3_600_000,
      ).toISOString();
      await repo.ReplaceInvite({ Code: code, TeamID: teamId, ExpiresAt: expiresAt }, userId);
      data = { code, teamId, expiresAt };
      break;
    }
    case "getTeamCurrentInvite": {
      const invite = await repo.GetLatestInviteCodeByTeamID(teamId);
      data = { code: invite.Code, teamId: invite.TeamID, expiresAt: invite.ExpiresAt };
      break;
    }
    case "postTeamJoin": {
      const inviteCode = input.body.code.trim().toUpperCase();
      const invite = await repo.GetInviteCode(inviteCode);
      invariant(invite.ExpiresAt >= now, "invite code expired");
      invariant(invite.TeamID !== teamId, "already joined team", 409);
      await repo.MoveMember({
        userId,
        fromTeamId: teamId,
        toTeamId: invite.TeamID,
        inviteCode: invite.Code,
        now,
      });
      member = await membership(repo, userId);
      data = { teamId: member.TeamID };
      break;
    }
    case "postTeamLeave": {
      const user = await repo.GetUserByID(userId);
      const newId = crypto.randomUUID();
      await repo.MoveMember({
        userId,
        fromTeamId: teamId,
        toTeamId: newId,
        now,
        newTeamName: ownTeamName(effectiveName(user.DisplayName, user.Nickname)),
      });
      member = await membership(repo, userId);
      data = { teamId: member.TeamID };
      break;
    }
    case "listTasks":
      data = {
        items: (await repo.ListTasksByTeamID(teamId))
          .filter((task) => !input.params.type || task.Type === input.params.type)
          .map(map.task),
      };
      break;
    case "postTask": {
      const body = input.body;
      const id = crypto.randomUUID();
      const assignee = body.assigneeUserId ?? "";
      if (assignee)
        invariant(
          (await repo.ListTeamMembersByTeamID(teamId)).some((m) => m.UserID === assignee),
          "assignee must be a team member",
        );
      await repo.CreateTask({
        ID: id,
        TeamID: teamId,
        Title: requiredText(body.title),
        Notes: body.notes ?? null,
        Type: body.type,
        PenaltyPoints: body.penaltyPoints,
        AssigneeUserID: assignee,
        RequiredCompletionsPerWeek:
          body.type === "daily" ? 1 : (body.requiredCompletionsPerWeek ?? 1),
        SortKey: 100,
        CreatedAt: now,
        UpdatedAt: now,
      });
      data = map.task(await repo.GetTaskByID(id));
      break;
    }
    case "patchTask": {
      const task = await repo.GetTaskByID(input.params.taskId);
      const body = input.body;
      invariant(task.TeamID === teamId && !task.DeletedAt, "task not found", 404);
      const assignee = body.assigneeUserId;
      if (assignee)
        invariant(
          (await repo.ListTeamMembersByTeamID(teamId)).some((m) => m.UserID === assignee),
          "assignee must be a team member",
        );
      await repo.UpdateTask({
        ID: task.ID,
        Title: body.title !== undefined ? requiredText(body.title) : undefined,
        Notes: body.notes,
        PenaltyPoints: body.penaltyPoints,
        AssigneeUserID: assignee,
        RequiredCompletionsPerWeek: task.Type === "daily" ? 1 : body.requiredCompletionsPerWeek,
        UpdatedAt: now,
      });
      data = map.task(await repo.GetTaskByID(task.ID));
      break;
    }
    case "deleteTask": {
      const task = await repo.GetTaskByID(input.params.taskId);
      invariant(task.TeamID === teamId && !task.DeletedAt, "task not found", 404);
      await repo.DeleteTask(task.ID);
      data = {};
      break;
    }
    case "postTasksReorder": {
      const rows = await repo.ListTasksByTeamID(teamId);
      const ids = input.body.taskIds;
      invariant(ids.length, "taskIds is required");
      const firstTask = rows.find((task) => task.ID === ids[0]);
      invariant(firstTask, "tasks not found", 404);
      const group = rows.filter((task) => task.Type === firstTask.Type);
      validateReorder(
        group.map((task) => task.ID),
        ids,
      );
      await repo.Reorder({
        teamId,
        ids,
        kind: "tasks",
        type: firstTask.Type,
        now,
      });
      data = {
        items: (await repo.ListTasksByTeamID(teamId))
          .filter((task) => task.Type === firstTask.Type)
          .map(map.task),
      };
      break;
    }
    case "postTaskCompletion": {
      const task = await repo.GetTaskByID(input.params.taskId);
      const targetDate = input.body.targetDate;
      const action = input.body.action;
      invariant(task.TeamID === teamId, "task not found", 404);
      invariant(task.Type === "daily" || task.Type === "weekly", "invalid task type");
      const periodStart = task.Type === "daily" ? targetDate : weekStart(targetDate);
      const periodEnd = addDays(periodStart, task.Type === "daily" ? 1 : 7);
      invariant(
        effectiveAt({ createdAt: task.CreatedAt, deletedAt: task.DeletedAt }, periodEnd),
        "task was not effective in target period",
      );
      completionCount(task.Type, 0, task.RequiredCompletionsPerWeek, action, targetDate, today);
      const isPastPeriod =
        task.Type === "daily" ? targetDate < today : periodStart < weekStart(today);
      const month = (task.Type === "daily" ? targetDate : addDays(periodStart, 6)).slice(0, 7);
      const completedCount = await repo.SetCompletion({
        teamId,
        userId,
        taskId: task.ID,
        type: task.Type,
        target: periodStart,
        action,
        cutoff: midnightJST(periodEnd),
        now,
        recalculateMonth: isPastPeriod ? month : undefined,
        ensureCoverage: month < today.slice(0, 7),
      });
      data = {
        taskId: task.ID,
        targetDate,
        completed: completedCount >= (task.Type === "daily" ? 1 : task.RequiredCompletionsPerWeek),
        weeklyCompletedCount: task.Type === "daily" ? 0 : completedCount,
      };
      break;
    }
    case "listShoppingItems":
      data = { items: (await repo.ListShoppingItemsByTeamID(teamId)).map(map.shopping) };
      break;
    case "postShoppingItem": {
      const id = crypto.randomUUID();
      await repo.CreateShoppingItem({
        ID: id,
        TeamID: teamId,
        Name: requiredText(input.body.name),
        Notes: input.body.notes ?? null,
        SortKey: 100,
        CreatedAt: now,
        UpdatedAt: now,
      });
      data = map.shopping(await repo.GetShoppingItemByID(id));
      break;
    }
    case "patchShoppingItem": {
      const item = await repo.GetShoppingItemByID(input.params.itemId);
      invariant(item.TeamID === teamId, "item not found", 404);
      await repo.UpdateShoppingItem({
        ID: item.ID,
        Name: input.body.name !== undefined ? requiredText(input.body.name) : undefined,
        Notes: input.body.notes === undefined ? undefined : input.body.notes?.trim() || null,
        UpdatedAt: now,
      });
      data = map.shopping(await repo.GetShoppingItemByID(item.ID));
      break;
    }
    case "deleteShoppingItem": {
      const item = await repo.GetShoppingItemByID(input.params.itemId);
      invariant(item.TeamID === teamId, "item not found", 404);
      await repo.DeleteShoppingItem(item.ID);
      data = {};
      break;
    }
    case "postShoppingItemsReorder": {
      const rows = await repo.ListShoppingItemsByTeamID(teamId);
      const ids = input.body.itemIds;
      validateReorder(
        rows.map((item) => item.ID),
        ids,
      );
      await repo.Reorder({
        teamId,
        ids,
        kind: "shopping",
        now,
      });
      data = { items: (await repo.ListShoppingItemsByTeamID(teamId)).map(map.shopping) };
      break;
    }
    case "listPenaltyRules":
      data = {
        items: (input.params.includeDeleted
          ? await repo.ListPenaltyRulesByTeamID(teamId)
          : await repo.ListUndeletedPenaltyRulesByTeamID(teamId)
        ).map(map.penalty),
      };
      break;
    case "postPenaltyRule": {
      const id = crypto.randomUUID();
      await repo.CreatePenaltyRule({
        ID: id,
        TeamID: teamId,
        Name: input.body.name,
        Description: input.body.description ?? null,
        Threshold: input.body.threshold,
        CreatedAt: now,
        UpdatedAt: now,
      });
      data = map.penalty(await repo.GetUndeletedPenaltyRuleByID(id));
      break;
    }
    case "patchPenaltyRule": {
      const rule = await repo.GetUndeletedPenaltyRuleByID(input.params.ruleId);
      invariant(rule.TeamID === teamId, "rule not found", 404);
      await repo.UpdatePenaltyRule({
        ID: rule.ID,
        Name: input.body.name?.trim(),
        Description: input.body.description,
        Threshold: input.body.threshold,
        UpdatedAt: now,
      });
      data = map.penalty(await repo.GetUndeletedPenaltyRuleByID(rule.ID));
      break;
    }
    case "deletePenaltyRule": {
      const rule = await repo.GetUndeletedPenaltyRuleByID(input.params.ruleId);
      invariant(rule.TeamID === teamId, "rule not found", 404);
      await repo.SoftDeletePenaltyRule({ ID: rule.ID, DeletedAt: now });
      data = {};
      break;
    }
    case "listReminderDefinitions":
      data = {
        items: (await repo.ListRemindersByTeamID(teamId))
          .filter((reminder) => reminder.Kind !== "one_time" || reminder.StartDate >= today)
          .map(map.reminder),
      };
      break;
    case "listReminders": {
      const { from, to } = input.params;
      invariant(to >= from, "to must be on or after from");
      const start = from > today.slice(0, 7) + "-01" ? from : today.slice(0, 7) + "-01";
      const items = await reminderOccurrences(repo, teamId, start, to, todayJST(context.now));
      data = {
        days: [...new Set(items.map((r) => r.date))].map((date) => ({
          date,
          items: items.filter((r) => r.date === date),
        })),
      };
      break;
    }
    case "postReminder": {
      const id = crypto.randomUUID();
      const body = input.body;
      validateReminder(body);
      await repo.CreateReminder({
        ID: id,
        TeamID: teamId,
        Title: requiredText(body.title),
        Notes: body.notes ?? null,
        Kind: body.kind,
        ScheduleType: body.scheduleType ?? null,
        StartDate: body.startDate,
        EndDate: body.endDate ?? null,
        CreatedAt: now,
        UpdatedAt: now,
      });
      data = map.reminder(await repo.GetReminderByID(id));
      break;
    }
    case "patchReminder": {
      const reminder = await repo.GetReminderByID(input.params.reminderId);
      const body = input.body;
      invariant(reminder.TeamID === teamId, "reminder not found", 404);
      const next = {
        ...map.reminder(reminder),
        ...body,
        title: body.title !== undefined ? requiredText(body.title) : reminder.Title,
      };
      if (next.kind === "one_time") {
        next.scheduleType = null;
        next.endDate = null;
      }
      validateReminder(next);
      await repo.UpdateReminder({
        ID: reminder.ID,
        Title: body.title !== undefined ? next.title : undefined,
        Notes: body.notes,
        Kind: body.kind,
        ScheduleType: body.kind === "one_time" ? null : body.scheduleType,
        StartDate: body.startDate,
        EndDate: body.kind === "one_time" ? null : body.endDate,
        UpdatedAt: now,
      });
      data = map.reminder(await repo.GetReminderByID(reminder.ID));
      break;
    }
    case "deleteReminder": {
      const reminder = await repo.GetReminderByID(input.params.reminderId);
      invariant(reminder.TeamID === teamId, "reminder not found", 404);
      await repo.DeleteReminder(reminder.ID);
      data = {};
      break;
    }
    case "getTaskOverview":
      data = await overview(repo, teamId, context.now);
      break;
    case "getPenaltySummaryMonthly":
      data = await monthlySummary(
        repo,
        teamId,
        input.params.month ?? today.slice(0, 7),
        context.now,
      );
      break;
    case "getMonthCloseCandidate":
      data = await monthCandidate(repo, teamId, context.now);
      break;
    case "postMonthClose":
      didChange = await closeMonth(repo, teamId, input.params.month, context.now);
      data = { closedAt: now, month: input.params.month };
      break;
    case "getPushSubscriptionsMe":
      data = {
        items: (await repo.ListPushSubscriptionsByUserID(userId)).map(map.push),
        vapidPublicKey: context.vapidPublicKey,
      };
      break;
    case "postPushSubscription": {
      const body = input.body;
      const url = new URL(body.endpoint);
      invariant(
        url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          ["web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com"].some(
            (host) => url.hostname === host || url.hostname.endsWith("." + host),
          ),
        "invalid push endpoint",
      );
      data = map.push(
        await repo.UpsertPushSubscription({
          ID: crypto.randomUUID(),
          TeamID: teamId,
          UserID: userId,
          Endpoint: body.endpoint,
          P256dh: requiredText(body.keys.p256dh),
          Auth: requiredText(body.keys.auth),
          UserAgent: body.userAgent ?? "",
          Platform: body.platform,
          LastSeenAt: now,
          CreatedAt: now,
          UpdatedAt: now,
        }),
      );
      break;
    }
    case "deletePushSubscription":
      invariant(
        await repo.DeactivatePushSubscriptionByIDAndUser({
          ID: input.params.subscriptionId,
          UserID: userId,
          UpdatedAt: now,
        }),
        "subscription not found",
        404,
      );
      data = {};
      break;
    default: {
      const exhaustive: never = input;
      throw new Error(`Unknown operation ${exhaustive}`);
    }
  }
  return {
    data,
    changedTeams:
      didChange && isTeamMutation(input.operation) ? [...new Set([teamId, member.TeamID])] : [],
  };
}
