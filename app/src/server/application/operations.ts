import type { Operation, TeamState } from "../../contracts/operations";
import type { Repository, ListMembershipsByUserIDRow } from "./ports";
import { AppError, invariant } from "../domain/errors";
import { addDays, todayJST, weekStart } from "../domain/dates";
import {
  completionCount,
  effectiveAt,
  effectiveName,
  ownTeamName,
  sortKeys,
  validateReminder,
} from "../domain/rules";
import * as map from "./mappers";
import {
  closeMonth,
  monthCandidate,
  monthlySummary,
  overview,
  recalculate,
  reminderOccurrences,
} from "./summary";

export interface OperationContext {
  userId: string;
  now: Date;
  vapidPublicKey: string;
}
const revisionExemptOperations = new Set<Operation["operation"]>([
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
  "postPushSubscription",
  "deletePushSubscription",
]);
function needsRevision(operation: Operation["operation"]) {
  return !revisionExemptOperations.has(operation);
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
): Promise<{ data: unknown; state: TeamState }> {
  return repository.transaction(async (repo) => {
    let member = await membership(repo, context.userId);
    let invite: Awaited<ReturnType<Repository["GetInviteCode"]>> | undefined;
    if (input.operation === "postTeamJoin")
      invite = await repo.GetInviteCode(input.body.code.trim().toUpperCase());

    const revision = await repo.GetTeamStateRevision(member.TeamID);
    const state = { teamId: member.TeamID, revision };
    if (needsRevision(input.operation)) {
      if (!input.expectedState)
        throw new AppError(
          428,
          "precondition_required",
          "最新状態の取得が必要です。画面を更新して再操作してください。",
          state,
        );
      if (
        input.expectedState.teamId !== state.teamId ||
        input.expectedState.revision !== state.revision
      )
        throw new AppError(
          412,
          "precondition_failed",
          "team state changed; refresh and retry",
          state,
        );
    }
    let changed = true;
    const teamId = member.TeamID,
      userId = context.userId,
      now = context.now.toISOString(),
      today = todayJST(context.now);
    let data: unknown;
    switch (input.operation) {
      case "getMe": {
        const r = await repo.GetUserByID(userId);
        data = {
          user: {
            id: r.ID,
            email: r.Email,
            displayName: r.DisplayName,
            colorHex: r.ColorHex,
            createdAt: r.CreatedAt,
          },
          memberships: [{ teamId, role: member.Role, teamName: member.TeamName }],
        };
        break;
      }
      case "patchMeNickname": {
        const nickname = input.body.nickname.trim();
        invariant(Array.from(nickname).length <= 30, "nickname must be 30 characters or fewer");
        await repo.UpdateUserNickname({ ID: userId, Column2: nickname });
        const r = await repo.GetUserByID(userId);
        data = { nickname, effectiveName: effectiveName(r.DisplayName, nickname) };
        break;
      }
      case "patchMeColor": {
        const color = input.body.colorHex?.trim().toUpperCase() || null;
        invariant(!color || /^#[0-9A-F]{6}$/.test(color), "invalid color");
        await repo.UpdateUserColorHex({ ID: userId, Column2: color ?? "" });
        data = { colorHex: color };
        break;
      }
      case "getTeamCurrentMembers":
        data = {
          items: (await repo.ListTeamMembersByTeamID(teamId)).map((r) => ({
            userId: r.UserID,
            displayName: r.DisplayName,
            nickname: r.Nickname || null,
            effectiveName: effectiveName(r.DisplayName, r.Nickname),
            colorHex: r.ColorHex,
            role: r.Role,
            joinedAt: r.CreatedAt,
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
        await repo.DeleteInviteCodesByTeamID(teamId);
        await repo.CreateInviteCode({ Code: code, TeamID: teamId, ExpiresAt: expiresAt });
        data = { code, teamId, expiresAt };
        break;
      }
      case "getTeamCurrentInvite": {
        const r = await repo.GetLatestInviteCodeByTeamID(teamId);
        data = { code: r.Code, teamId: r.TeamID, expiresAt: r.ExpiresAt };
        break;
      }
      case "postTeamJoin": {
        invariant(invite, "invite not found", 404);
        invite = await repo.GetInviteCode(invite.Code);
        invariant(invite.ExpiresAt >= now, "invite code expired");
        invariant(invite.TeamID !== teamId, "already joined team", 409);
        const deleted = await detach(repo, userId, member, now);
        await repo.AddTeamMember({
          TeamID: invite.TeamID,
          UserID: userId,
          Role: "member",
          CreatedAt: now,
        });
        if (!deleted)
          await repo.UpdateTeamStateRevisionIfMatch({ ID: teamId, StateRevision: revision });
        member = await membership(repo, userId);
        data = { teamId: member.TeamID };
        break;
      }
      case "postTeamLeave": {
        const deleted = await detach(repo, userId, member, now);
        const user = await repo.GetUserByID(userId),
          newId = crypto.randomUUID();
        await repo.CreateTeam({
          ID: newId,
          Name: ownTeamName(effectiveName(user.DisplayName, user.Nickname)),
          CreatedAt: now,
        });
        await repo.AddTeamMember({ TeamID: newId, UserID: userId, Role: "owner", CreatedAt: now });
        if (!deleted)
          await repo.UpdateTeamStateRevisionIfMatch({ ID: teamId, StateRevision: revision });
        member = await membership(repo, userId);
        data = { teamId: member.TeamID };
        break;
      }
      case "listTasks":
        data = {
          items: (await repo.ListTasksByTeamID(teamId))
            .filter((t) => !input.params.type || t.Type === input.params.type)
            .map(map.task),
        };
        break;
      case "postTask": {
        const b = input.body,
          id = crypto.randomUUID(),
          rows = (await repo.ListTasksByTeamID(teamId)).filter((t) => t.Type === b.type);
        let sortKey = rows[0] ? Math.floor(rows[0].SortKey / 2) : 100;
        if (sortKey < 1) {
          sortKey = 100;
          for (const [i, r] of rows.entries())
            await repo.UpdateTaskSortKey({ ID: r.ID, SortKey: (i + 2) * 100, UpdatedAt: now });
        }
        const assignee = b.assigneeUserId ?? "";
        if (assignee)
          invariant(
            (await repo.ListTeamMembersByTeamID(teamId)).some((m) => m.UserID === assignee),
            "assignee must be a team member",
          );
        await repo.CreateTask({
          ID: id,
          TeamID: teamId,
          Title: requiredText(b.title),
          Notes: b.notes ?? null,
          Type: b.type,
          PenaltyPoints: b.penaltyPoints,
          Column7: assignee,
          RequiredCompletionsPerWeek: b.type === "daily" ? 1 : (b.requiredCompletionsPerWeek ?? 1),
          SortKey: sortKey,
          CreatedAt: now,
          UpdatedAt: now,
        });
        data = map.task(await repo.GetTaskByID(id));
        break;
      }
      case "patchTask": {
        const r = await repo.GetTaskByID(input.params.taskId),
          b = input.body;
        invariant(r.TeamID === teamId && !r.DeletedAt, "task not found", 404);
        const assignee = b.assigneeUserId ?? r.AssigneeUserID;
        if (assignee)
          invariant(
            (await repo.ListTeamMembersByTeamID(teamId)).some((m) => m.UserID === assignee),
            "assignee must be a team member",
          );
        await repo.UpdateTask({
          ID: r.ID,
          Title: b.title !== undefined ? requiredText(b.title) : r.Title,
          Notes: b.notes ?? r.Notes,
          PenaltyPoints: b.penaltyPoints ?? r.PenaltyPoints,
          Column5: assignee,
          RequiredCompletionsPerWeek:
            r.Type === "daily" ? 1 : (b.requiredCompletionsPerWeek ?? r.RequiredCompletionsPerWeek),
          UpdatedAt: now,
        });
        data = map.task(await repo.GetTaskByID(r.ID));
        break;
      }
      case "deleteTask": {
        const r = await repo.GetTaskByID(input.params.taskId);
        invariant(r.TeamID === teamId && !r.DeletedAt, "task not found", 404);
        await repo.DeleteTask(r.ID);
        data = {};
        break;
      }
      case "postTasksReorder": {
        const rows = await repo.ListTasksByTeamID(teamId),
          ids = input.body.taskIds;
        invariant(ids.length, "taskIds is required");
        const first = rows.find((r) => r.ID === ids[0]);
        invariant(first, "tasks not found", 404);
        const group = rows.filter((r) => r.Type === first.Type),
          keys = sortKeys(
            group.map((r) => ({ id: r.ID, sortKey: r.SortKey })),
            ids,
          );
        for (const r of group)
          if (keys.get(r.ID) !== r.SortKey)
            await repo.UpdateTaskSortKey({ ID: r.ID, SortKey: keys.get(r.ID)!, UpdatedAt: now });
        data = {
          items: (await repo.ListTasksByTeamID(teamId))
            .filter((r) => r.Type === first.Type)
            .map(map.task),
        };
        break;
      }
      case "postTaskCompletionToggle": {
        const r = await repo.GetTaskByID(input.params.taskId),
          target = input.body.targetDate,
          action = input.body.action ?? "toggle";
        invariant(r.TeamID === teamId, "task not found", 404);
        invariant(r.Type === "daily" || r.Type === "weekly", "invalid task type");
        const start = r.Type === "daily" ? target : weekStart(target),
          cutoff = addDays(start, r.Type === "daily" ? 1 : 7);
        invariant(
          effectiveAt({ createdAt: r.CreatedAt, deletedAt: r.DeletedAt }, cutoff),
          "task was not effective in target period",
        );
        const count =
          r.Type === "daily"
            ? Number(await repo.HasTaskCompletionDaily({ TaskID: r.ID, TargetDate: target }))
            : await repo.GetTaskCompletionWeeklyEntryCount({ TaskID: r.ID, WeekStart: start });
        const next = completionCount(
          r.Type,
          count,
          r.RequiredCompletionsPerWeek,
          action,
          target,
          today,
        );
        if (next !== count) {
          if (r.Type === "daily") {
            if (next)
              await repo.CreateTaskCompletionDaily({
                TaskID: r.ID,
                TargetDate: target,
                CompletedByUserID: userId,
              });
            else await repo.DeleteTaskCompletionDaily({ TaskID: r.ID, TargetDate: target });
          } else if (next > count)
            await repo.InsertTaskCompletionWeeklyEntry({
              ID: crypto.randomUUID(),
              TaskID: r.ID,
              WeekStart: start,
              CompletedByUserID: userId,
            });
          else await repo.DeleteLatestTaskCompletionWeeklyEntry({ TaskID: r.ID, WeekStart: start });
          if (r.Type === "daily" ? target < today : start < weekStart(today)) {
            const month = (r.Type === "daily" ? target : addDays(start, 6)).slice(0, 7);
            await recalculate(repo, teamId, month, month < today.slice(0, 7));
          }
        }
        data = {
          taskId: r.ID,
          targetDate: target,
          completed: next >= (r.Type === "daily" ? 1 : r.RequiredCompletionsPerWeek),
          weeklyCompletedCount: r.Type === "daily" ? 0 : next,
        };
        break;
      }
      case "listShoppingItems":
        data = { items: (await repo.ListShoppingItemsByTeamID(teamId)).map(map.shopping) };
        break;
      case "postShoppingItem": {
        const id = crypto.randomUUID(),
          rows = await repo.ListShoppingItemsByTeamID(teamId);
        let key = rows[0] ? Math.floor(rows[0].SortKey / 2) : 100;
        if (key < 1) {
          key = 100;
          for (const [i, r] of rows.entries())
            await repo.UpdateShoppingItemSortKey({
              ID: r.ID,
              SortKey: (i + 2) * 100,
              UpdatedAt: now,
            });
        }
        await repo.CreateShoppingItem({
          ID: id,
          TeamID: teamId,
          Name: requiredText(input.body.name),
          Notes: input.body.notes ?? null,
          SortKey: key,
          CreatedAt: now,
          UpdatedAt: now,
        });
        data = map.shopping(await repo.GetShoppingItemByID(id));
        break;
      }
      case "patchShoppingItem": {
        const r = await repo.GetShoppingItemByID(input.params.itemId);
        invariant(r.TeamID === teamId, "item not found", 404);
        await repo.UpdateShoppingItem({
          ID: r.ID,
          Name: input.body.name !== undefined ? requiredText(input.body.name) : r.Name,
          Notes: input.body.notes == null ? r.Notes : input.body.notes.trim() || null,
          UpdatedAt: now,
        });
        data = map.shopping(await repo.GetShoppingItemByID(r.ID));
        break;
      }
      case "deleteShoppingItem": {
        const r = await repo.GetShoppingItemByID(input.params.itemId);
        invariant(r.TeamID === teamId, "item not found", 404);
        await repo.DeleteShoppingItem(r.ID);
        data = {};
        break;
      }
      case "postShoppingItemsReorder": {
        const rows = await repo.ListShoppingItemsByTeamID(teamId),
          keys = sortKeys(
            rows.map((r) => ({ id: r.ID, sortKey: r.SortKey })),
            input.body.itemIds,
          );
        for (const r of rows)
          if (keys.get(r.ID) !== r.SortKey)
            await repo.UpdateShoppingItemSortKey({
              ID: r.ID,
              SortKey: keys.get(r.ID)!,
              UpdatedAt: now,
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
        const r = await repo.GetUndeletedPenaltyRuleByID(input.params.ruleId);
        invariant(r.TeamID === teamId, "rule not found", 404);
        await repo.UpdatePenaltyRule({
          ID: r.ID,
          Name: input.body.name?.trim() ?? r.Name,
          Description: input.body.description ?? r.Description,
          Threshold: input.body.threshold ?? r.Threshold,
          UpdatedAt: now,
        });
        data = map.penalty(await repo.GetUndeletedPenaltyRuleByID(r.ID));
        break;
      }
      case "deletePenaltyRule": {
        const r = await repo.GetUndeletedPenaltyRuleByID(input.params.ruleId);
        invariant(r.TeamID === teamId, "rule not found", 404);
        await repo.SoftDeletePenaltyRule({ ID: r.ID, DeletedAt: now });
        data = {};
        break;
      }
      case "listReminderDefinitions":
        await repo.DeleteExpiredOneTimeRemindersByTeam({ TeamID: teamId, StartDate: today });
        data = { items: (await repo.ListRemindersByTeamID(teamId)).map(map.reminder) };
        break;
      case "listReminders": {
        const { from, to } = input.params;
        invariant(to >= from, "to must be on or after from");
        await repo.DeleteExpiredOneTimeRemindersByTeam({ TeamID: teamId, StartDate: today });
        const start = from > today.slice(0, 7) + "-01" ? from : today.slice(0, 7) + "-01",
          items = await reminderOccurrences(repo, teamId, start, to);
        data = {
          days: [...new Set(items.map((r) => r.date))].map((date) => ({
            date,
            items: items.filter((r) => r.date === date),
          })),
        };
        break;
      }
      case "postReminder": {
        const id = crypto.randomUUID(),
          b = input.body;
        validateReminder(b);
        await repo.CreateReminder({
          ID: id,
          TeamID: teamId,
          Title: requiredText(b.title),
          Notes: b.notes ?? null,
          Kind: b.kind,
          ScheduleType: b.scheduleType ?? null,
          StartDate: b.startDate,
          EndDate: b.endDate ?? null,
          CreatedAt: now,
          UpdatedAt: now,
        });
        data = map.reminder(await repo.GetReminderByID(id));
        break;
      }
      case "patchReminder": {
        const r = await repo.GetReminderByID(input.params.reminderId),
          b = input.body;
        invariant(r.TeamID === teamId, "reminder not found", 404);
        const next = {
          ...map.reminder(r),
          ...b,
          title: b.title !== undefined ? requiredText(b.title) : r.Title,
        };
        if (next.kind === "one_time") {
          next.scheduleType = null;
          next.endDate = null;
        }
        validateReminder(next);
        await repo.UpdateReminder({
          ID: r.ID,
          Title: next.title,
          Notes: next.notes ?? null,
          Kind: next.kind,
          ScheduleType: next.scheduleType ?? null,
          StartDate: next.startDate,
          EndDate: next.endDate ?? null,
          UpdatedAt: now,
        });
        data = map.reminder(await repo.GetReminderByID(r.ID));
        break;
      }
      case "deleteReminder": {
        const r = await repo.GetReminderByID(input.params.reminderId);
        invariant(r.TeamID === teamId, "reminder not found", 404);
        await repo.DeleteReminder(r.ID);
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
        changed = await closeMonth(repo, teamId, input.params.month, context.now);
        data = { closedAt: now, month: input.params.month };
        break;
      case "getPushSubscriptionsMe":
        data = {
          items: (await repo.ListPushSubscriptionsByUserID(userId)).map(map.push),
          vapidPublicKey: context.vapidPublicKey,
        };
        break;
      case "postPushSubscription": {
        const b = input.body,
          url = new URL(b.endpoint);
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
            Endpoint: b.endpoint,
            P256dh: requiredText(b.keys.p256dh),
            Auth: requiredText(b.keys.auth),
            Column7: b.userAgent ?? "",
            Platform: b.platform,
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
    const finalRevision = await repo.GetTeamStateRevision(member.TeamID);
    const next =
      changed && needsRevision(input.operation)
        ? await repo.UpdateTeamStateRevisionIfMatch({
            ID: member.TeamID,
            StateRevision: finalRevision,
          })
        : finalRevision;
    return { data, state: { teamId: member.TeamID, revision: next } };
  });
}
async function detach(
  repo: Repository,
  userId: string,
  member: ListMembershipsByUserIDRow,
  now: string,
) {
  for (const subscription of await repo.ListPushSubscriptionsByUserID(userId)) {
    if (subscription.TeamID === member.TeamID && subscription.IsActive)
      await repo.DeactivatePushSubscriptionByIDAndUser({
        ID: subscription.ID,
        UserID: userId,
        UpdatedAt: now,
      });
  }
  await repo.ClearTaskAssigneeByTeamAndUser({ TeamID: member.TeamID, Column2: userId });
  if (member.Role === "owner") {
    const others = (await repo.ListTeamMembersByTeamID(member.TeamID)).filter(
      (m) => m.UserID !== userId,
    );
    if (!others.length) {
      await repo.DeleteTeam(member.TeamID);
      return true;
    }
    await repo.UpdateTeamMemberRole({
      TeamID: member.TeamID,
      UserID: others[0].UserID,
      Role: "owner",
    });
  }
  await repo.DeleteTeamMember({ TeamID: member.TeamID, UserID: userId });
  return false;
}
