import {
  and,
  eq,
  ne,
  lt,
  gte,
  or,
  isNull,
  exists,
  desc,
  count,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import type * as P from "../application/ports";
import { AppError } from "../domain/errors";
import { addDays } from "../domain/dates";
import { UnitOfWork, atomic } from "./unit-of-work";
import type { Database } from "./database";
import { user } from "./auth-schema";
import {
  teams,
  teamMembers,
  tasks,
  taskCompletionDaily,
  taskCompletionWeeklyEntries,
  inviteCodes,
  shoppingItems,
  reminders,
  penaltyRules,
  monthlyPenaltySummaries,
  monthlyPenaltySummaryTriggeredRules,
  closeRuns,
  pushSubscriptions,
} from "./schema";

function required<T>(rows: T[], operation: string): T {
  if (!rows[0]) throw new AppError(404, "not_found", `${operation}: not found`);
  return rows[0];
}
const emptyText = (column: SQLWrapper) => sql<string>`COALESCE(${column}, '')`;
const iso = (column: SQLWrapper) =>
  sql<string>`${column}`.mapWith((value: string) => new Date(value).toISOString());
const nullableIso = (column: SQLWrapper) =>
  sql<string | null>`${column}`.mapWith((value: string | null) =>
    value === null ? null : new Date(value).toISOString(),
  );
const effectiveName = sql<string>`COALESCE(NULLIF(${user.nickname}, ''), ${user.name}, '')`;
const totalPenalty = sql<number>`COALESCE(SUM(${tasks.penalty_points}), 0)`.mapWith(Number);
const dayCloseBoundary = sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ',${closeRuns.target_date},'+1 days','-9 hours')`;
const weekCloseBoundary = sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ',${closeRuns.target_date},'+7 days','-9 hours')`;
const weekEnd = sql<string>`date(${closeRuns.target_date},'+6 days')`;
const inviteFields = {
  Code: inviteCodes.code,
  TeamID: inviteCodes.team_id,
  ExpiresAt: iso(inviteCodes.expires_at),
  CreatedAt: iso(inviteCodes.created_at),
};
const monthlyTaskFields = {
  ID: tasks.id,
  Title: tasks.title,
  Notes: tasks.notes,
  Type: tasks.type,
  PenaltyPoints: tasks.penalty_points,
  RequiredCompletionsPerWeek: tasks.required_completions_per_week,
  SortKey: tasks.sort_key,
  CreatedAt: iso(tasks.created_at),
  DeletedAt: nullableIso(tasks.deleted_at),
};
const taskFields = {
  ...monthlyTaskFields,
  TeamID: tasks.team_id,
  AssigneeUserID: emptyText(tasks.assignee_user_id),
  UpdatedAt: iso(tasks.updated_at),
};
const pushFields = {
  ID: pushSubscriptions.id,
  TeamID: pushSubscriptions.team_id,
  UserID: pushSubscriptions.user_id,
  Endpoint: pushSubscriptions.endpoint,
  P256dh: pushSubscriptions.p256dh,
  Auth: pushSubscriptions.auth,
  UserAgent: emptyText(pushSubscriptions.user_agent),
  Platform: pushSubscriptions.platform,
  IsActive: sql<boolean>`${pushSubscriptions.is_active}`.mapWith(Boolean),
  LastSeenAt: iso(pushSubscriptions.last_seen_at),
  CreatedAt: iso(pushSubscriptions.created_at),
  UpdatedAt: iso(pushSubscriptions.updated_at),
};
const shoppingFields = {
  ID: shoppingItems.id,
  TeamID: shoppingItems.team_id,
  Name: shoppingItems.name,
  Notes: shoppingItems.notes,
  SortKey: shoppingItems.sort_key,
  CreatedAt: iso(shoppingItems.created_at),
  UpdatedAt: iso(shoppingItems.updated_at),
};
const reminderFields = {
  ID: reminders.id,
  TeamID: reminders.team_id,
  Title: reminders.title,
  Notes: reminders.notes,
  Kind: reminders.kind,
  ScheduleType: reminders.schedule_type,
  StartDate: reminders.start_date,
  EndDate: reminders.end_date,
  CreatedAt: iso(reminders.created_at),
  UpdatedAt: iso(reminders.updated_at),
};
const penaltyFields = {
  ID: penaltyRules.id,
  TeamID: penaltyRules.team_id,
  Threshold: penaltyRules.threshold,
  Name: penaltyRules.name,
  Description: penaltyRules.description,
  DeletedAt: nullableIso(penaltyRules.deleted_at),
  CreatedAt: iso(penaltyRules.created_at),
  UpdatedAt: iso(penaltyRules.updated_at),
};

export class D1Repository implements P.Repository {
  private readonly unit: UnitOfWork;
  constructor(db: Database, unit?: UnitOfWork) {
    this.unit = unit ?? new UnitOfWork(db);
  }
  async transaction<T>(fn: (repo: P.Repository) => Promise<T>): Promise<T> {
    if (this.unit.active) return fn(this);
    return atomic(this.unit.db, (unit) => fn(new D1Repository(this.unit.db, unit)));
  }
  async CreateTaskCompletionDaily(arg: P.CreateTaskCompletionDailyParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.CreateTaskCompletionDaily(arg));
    if (await this.HasTaskCompletionDaily(arg)) return;
    await this.unit.insert(taskCompletionDaily, {
      task_id: arg.TaskID,
      target_date: arg.TargetDate,
      completed_by_user_id: arg.CompletedByUserID || null,
      created_at: new Date().toISOString(),
    });
  }
  async DeleteLatestTaskCompletionWeeklyEntry(
    arg: P.DeleteLatestTaskCompletionWeeklyEntryParams,
  ): Promise<number> {
    if (!this.unit.active)
      return this.transaction((repo) => repo.DeleteLatestTaskCompletionWeeklyEntry(arg));
    const [row] = await this.unit.read
      .select({ id: taskCompletionWeeklyEntries.id })
      .from(taskCompletionWeeklyEntries)
      .where(
        and(
          eq(taskCompletionWeeklyEntries.task_id, arg.TaskID),
          eq(taskCompletionWeeklyEntries.week_start, arg.WeekStart),
        ),
      )
      .orderBy(desc(taskCompletionWeeklyEntries.created_at), desc(taskCompletionWeeklyEntries.id))
      .limit(1);
    return row
      ? this.unit.remove(taskCompletionWeeklyEntries, eq(taskCompletionWeeklyEntries.id, row.id))
      : 0;
  }
  async DeleteTaskCompletionDaily(arg: P.DeleteTaskCompletionDailyParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.DeleteTaskCompletionDaily(arg));
    await this.unit.remove(
      taskCompletionDaily,
      and(
        eq(taskCompletionDaily.task_id, arg.TaskID),
        eq(taskCompletionDaily.target_date, arg.TargetDate),
      )!,
    );
  }
  async GetTaskCompletionWeeklyEntryCount(
    arg: P.GetTaskCompletionWeeklyEntryCountParams,
  ): Promise<number> {
    const rows = await this.unit.read
      .select({ count: count() })
      .from(taskCompletionWeeklyEntries)
      .where(
        and(
          eq(taskCompletionWeeklyEntries.task_id, arg.TaskID),
          eq(taskCompletionWeeklyEntries.week_start, arg.WeekStart),
        ),
      );
    return required(rows, "GetTaskCompletionWeeklyEntryCount").count;
  }
  async HasTaskCompletionDaily(arg: P.HasTaskCompletionDailyParams): Promise<boolean> {
    const rows = await this.unit.read
      .select({ id: taskCompletionDaily.task_id })
      .from(taskCompletionDaily)
      .where(
        and(
          eq(taskCompletionDaily.task_id, arg.TaskID),
          eq(taskCompletionDaily.target_date, arg.TargetDate),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
  async InsertTaskCompletionWeeklyEntry(
    arg: P.InsertTaskCompletionWeeklyEntryParams,
  ): Promise<void> {
    if (!this.unit.active)
      return this.transaction((repo) => repo.InsertTaskCompletionWeeklyEntry(arg));
    await this.unit.insert(taskCompletionWeeklyEntries, {
      id: arg.ID,
      task_id: arg.TaskID,
      week_start: arg.WeekStart,
      completed_by_user_id: arg.CompletedByUserID || null,
      created_at: new Date().toISOString(),
    });
  }
  async ListTaskCompletionDailyByMonthAndTeam(
    arg: P.ListTaskCompletionDailyByMonthAndTeamParams,
  ): Promise<P.ListTaskCompletionDailyByMonthAndTeamRow[]> {
    return this.unit.read
      .select({
        TaskID: taskCompletionDaily.task_id,
        CompletedByUserID: emptyText(taskCompletionDaily.completed_by_user_id),
        CompletedByEffectiveName: effectiveName,
        CompletedByColorHex: user.colorHex,
        TargetDate: taskCompletionDaily.target_date,
      })
      .from(taskCompletionDaily)
      .innerJoin(tasks, eq(tasks.id, taskCompletionDaily.task_id))
      .leftJoin(user, eq(user.id, taskCompletionDaily.completed_by_user_id))
      .where(
        and(
          eq(tasks.team_id, arg.TeamID),
          gte(taskCompletionDaily.target_date, arg.TargetDate),
          lt(taskCompletionDaily.target_date, arg.TargetDate_2),
        ),
      )
      .orderBy(taskCompletionDaily.target_date, taskCompletionDaily.task_id);
  }
  async ListTaskCompletionDailyByTeamAndDate(
    arg: P.ListTaskCompletionDailyByTeamAndDateParams,
  ): Promise<P.ListTaskCompletionDailyByTeamAndDateRow[]> {
    return this.unit.read
      .select({
        TaskID: taskCompletionDaily.task_id,
        CompletedByUserID: emptyText(taskCompletionDaily.completed_by_user_id),
        CompletedByEffectiveName: effectiveName,
        CompletedByColorHex: user.colorHex,
      })
      .from(taskCompletionDaily)
      .innerJoin(tasks, eq(tasks.id, taskCompletionDaily.task_id))
      .leftJoin(user, eq(user.id, taskCompletionDaily.completed_by_user_id))
      .where(
        and(
          eq(tasks.team_id, arg.TeamID),
          eq(tasks.type, "daily"),
          eq(taskCompletionDaily.target_date, arg.TargetDate),
        ),
      )
      .orderBy(taskCompletionDaily.task_id);
  }
  async ListTaskCompletionWeeklyCountsByTeamAndWeek(
    arg: P.ListTaskCompletionWeeklyCountsByTeamAndWeekParams,
  ): Promise<P.ListTaskCompletionWeeklyCountsByTeamAndWeekRow[]> {
    return this.unit.read
      .select({ TaskID: taskCompletionWeeklyEntries.task_id, CompletionCount: count() })
      .from(taskCompletionWeeklyEntries)
      .innerJoin(tasks, eq(tasks.id, taskCompletionWeeklyEntries.task_id))
      .where(
        and(
          eq(tasks.team_id, arg.TeamID),
          eq(tasks.type, "weekly"),
          eq(taskCompletionWeeklyEntries.week_start, arg.WeekStart),
        ),
      )
      .groupBy(taskCompletionWeeklyEntries.task_id)
      .orderBy(taskCompletionWeeklyEntries.task_id);
  }
  async ListTaskCompletionWeeklySlotsByMonthAndTeam(
    arg: P.ListTaskCompletionWeeklySlotsByMonthAndTeamParams,
  ): Promise<P.ListTaskCompletionWeeklySlotsByMonthAndTeamRow[]> {
    return this.unit.read
      .select({
        TaskID: taskCompletionWeeklyEntries.task_id,
        WeekStart: taskCompletionWeeklyEntries.week_start,
        Slot: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${taskCompletionWeeklyEntries.task_id}, ${taskCompletionWeeklyEntries.week_start} ORDER BY ${taskCompletionWeeklyEntries.created_at}, ${taskCompletionWeeklyEntries.id})`.mapWith(
          Number,
        ),
        CompletedByUserID: emptyText(taskCompletionWeeklyEntries.completed_by_user_id),
        CompletedByEffectiveName: effectiveName,
        CompletedByColorHex: user.colorHex,
      })
      .from(taskCompletionWeeklyEntries)
      .innerJoin(tasks, eq(tasks.id, taskCompletionWeeklyEntries.task_id))
      .leftJoin(user, eq(user.id, taskCompletionWeeklyEntries.completed_by_user_id))
      .where(
        and(
          eq(tasks.team_id, arg.TeamID),
          eq(tasks.type, "weekly"),
          gte(taskCompletionWeeklyEntries.week_start, arg.WeekStart),
          lt(taskCompletionWeeklyEntries.week_start, arg.WeekStart_2),
        ),
      )
      .orderBy(
        taskCompletionWeeklyEntries.week_start,
        taskCompletionWeeklyEntries.task_id,
        taskCompletionWeeklyEntries.created_at,
        taskCompletionWeeklyEntries.id,
      );
  }
  async ListTaskCompletionWeeklySlotsByTeamAndWeek(
    arg: P.ListTaskCompletionWeeklySlotsByTeamAndWeekParams,
  ): Promise<P.ListTaskCompletionWeeklySlotsByTeamAndWeekRow[]> {
    return this.unit.read
      .select({
        TaskID: taskCompletionWeeklyEntries.task_id,
        Slot: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${taskCompletionWeeklyEntries.task_id}, ${taskCompletionWeeklyEntries.week_start} ORDER BY ${taskCompletionWeeklyEntries.created_at}, ${taskCompletionWeeklyEntries.id})`.mapWith(
          Number,
        ),
        CompletedByUserID: emptyText(taskCompletionWeeklyEntries.completed_by_user_id),
        CompletedByEffectiveName: effectiveName,
        CompletedByColorHex: user.colorHex,
      })
      .from(taskCompletionWeeklyEntries)
      .innerJoin(tasks, eq(tasks.id, taskCompletionWeeklyEntries.task_id))
      .leftJoin(user, eq(user.id, taskCompletionWeeklyEntries.completed_by_user_id))
      .where(
        and(
          eq(tasks.team_id, arg.TeamID),
          eq(tasks.type, "weekly"),
          eq(taskCompletionWeeklyEntries.week_start, arg.WeekStart),
        ),
      )
      .orderBy(
        taskCompletionWeeklyEntries.week_start,
        taskCompletionWeeklyEntries.task_id,
        taskCompletionWeeklyEntries.created_at,
        taskCompletionWeeklyEntries.id,
      );
  }
  async AddTeamMember(arg: P.AddTeamMemberParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.AddTeamMember(arg));
    await this.unit.insert(teamMembers, {
      team_id: arg.TeamID,
      user_id: arg.UserID,
      role: arg.Role,
      created_at: arg.CreatedAt,
    });
  }
  async CreateTeam(arg: P.CreateTeamParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.CreateTeam(arg));
    await this.unit.insert(teams, {
      id: arg.ID,
      name: arg.Name,
      created_at: arg.CreatedAt,
      state_revision: "0",
    });
  }
  async DeleteTeam(id: string): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.DeleteTeam(id));
    const taskRows = await this.unit.read
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.team_id, id));
    for (const task of taskRows) {
      await this.unit.remove(taskCompletionDaily, eq(taskCompletionDaily.task_id, task.id));
      await this.unit.remove(
        taskCompletionWeeklyEntries,
        eq(taskCompletionWeeklyEntries.task_id, task.id),
      );
    }
    for (const table of [
      monthlyPenaltySummaryTriggeredRules,
      monthlyPenaltySummaries,
      tasks,
      penaltyRules,
      shoppingItems,
      reminders,
      inviteCodes,
      closeRuns,
      pushSubscriptions,
      teamMembers,
    ])
      await this.unit.remove(table, eq(table.team_id, id));
    await this.unit.remove(teams, eq(teams.id, id));
  }
  async DeleteTeamMember(arg: P.DeleteTeamMemberParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.DeleteTeamMember(arg));
    await this.unit.remove(
      teamMembers,
      and(eq(teamMembers.team_id, arg.TeamID), eq(teamMembers.user_id, arg.UserID))!,
    );
  }
  async GetTeamStateRevision(id: string): Promise<string> {
    const rows = await this.unit.read
      .select({ revision: teams.state_revision })
      .from(teams)
      .where(eq(teams.id, id));
    return required(rows, "GetTeamStateRevision").revision;
  }
  async ListMembershipsByUserID(userID: string): Promise<P.ListMembershipsByUserIDRow[]> {
    return this.unit.read
      .select({ TeamID: teamMembers.team_id, Role: teamMembers.role, TeamName: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.team_id))
      .where(eq(teamMembers.user_id, userID));
  }
  async ListTeamIDsForClose(): Promise<string[]> {
    const rows = await this.unit.read
      .select({ id: teams.id })
      .from(teams)
      .where(
        exists(
          this.unit.db
            .select({ id: teamMembers.user_id })
            .from(teamMembers)
            .where(eq(teamMembers.team_id, teams.id)),
        ),
      )
      .orderBy(teams.created_at, teams.id);
    return rows.map((row) => row.id);
  }
  async ListTeamMembersByTeamID(teamID: string): Promise<P.ListTeamMembersByTeamIDRow[]> {
    return this.unit.read
      .select({
        TeamID: teamMembers.team_id,
        UserID: teamMembers.user_id,
        Role: teamMembers.role,
        CreatedAt: iso(teamMembers.created_at),
        DisplayName: user.name,
        Nickname: emptyText(user.nickname),
        ColorHex: user.colorHex,
      })
      .from(teamMembers)
      .innerJoin(user, eq(user.id, teamMembers.user_id))
      .where(eq(teamMembers.team_id, teamID))
      .orderBy(teamMembers.created_at);
  }
  async UpdateTeamMemberRole(arg: P.UpdateTeamMemberRoleParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.UpdateTeamMemberRole(arg));
    await this.unit.update(
      teamMembers,
      and(eq(teamMembers.team_id, arg.TeamID), eq(teamMembers.user_id, arg.UserID))!,
      {
        role: arg.Role,
      },
    );
  }
  async UpdateTeamName(arg: P.UpdateTeamNameParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.UpdateTeamName(arg));
    await this.unit.update(teams, eq(teams.id, arg.ID), { name: arg.Name });
  }
  async UpdateTeamStateRevisionIfMatch(
    arg: P.UpdateTeamStateRevisionIfMatchParams,
  ): Promise<string> {
    if (!this.unit.active)
      return this.transaction((repo) => repo.UpdateTeamStateRevisionIfMatch(arg));
    const current = await this.GetTeamStateRevision(arg.ID);
    if (current !== arg.StateRevision)
      throw new AppError(412, "precondition_failed", "team state changed", {
        teamId: arg.ID,
        revision: current,
      });
    const next = (BigInt(current) + 1n).toString();
    await this.unit.update(teams, eq(teams.id, arg.ID), { state_revision: next });
    return next;
  }
  async SumDailyPenaltyForClose(arg: P.SumDailyPenaltyForCloseParams): Promise<number> {
    const rows = await this.unit.read
      .select({ total: totalPenalty })
      .from(tasks)
      .leftJoin(
        taskCompletionDaily,
        and(
          eq(taskCompletionDaily.task_id, tasks.id),
          eq(taskCompletionDaily.target_date, arg.TargetDate),
        ),
      )
      .where(
        and(
          eq(tasks.team_id, arg.TeamID),
          eq(tasks.type, "daily"),
          lt(tasks.created_at, arg.CreatedAt),
          or(isNull(tasks.deleted_at), gte(tasks.deleted_at, arg.CreatedAt)),
          isNull(taskCompletionDaily.task_id),
        ),
      );
    return required(rows, "SumDailyPenaltyForClose").total;
  }
  async SumDailyPenaltyForMonth(arg: P.SumDailyPenaltyForMonthParams): Promise<number> {
    const rows = await this.unit.read
      .select({ total: totalPenalty })
      .from(closeRuns)
      .innerJoin(
        tasks,
        and(
          eq(tasks.team_id, closeRuns.team_id),
          eq(tasks.type, "daily"),
          lt(tasks.created_at, dayCloseBoundary),
          or(isNull(tasks.deleted_at), gte(tasks.deleted_at, dayCloseBoundary)),
        ),
      )
      .leftJoin(
        taskCompletionDaily,
        and(
          eq(taskCompletionDaily.task_id, tasks.id),
          eq(taskCompletionDaily.target_date, closeRuns.target_date),
        ),
      )
      .where(
        and(
          eq(closeRuns.team_id, arg.TeamID),
          eq(closeRuns.scope, "close_day"),
          gte(closeRuns.target_date, arg.TargetDate),
          lt(closeRuns.target_date, arg.TargetDate_2),
          isNull(taskCompletionDaily.task_id),
        ),
      );
    return required(rows, "SumDailyPenaltyForMonth").total;
  }
  async SumWeeklyPenaltyForClose(arg: P.SumWeeklyPenaltyForCloseParams): Promise<number> {
    const rows = await this.unit.read
      .select({ total: totalPenalty })
      .from(tasks)
      .where(
        and(
          eq(tasks.team_id, arg.TeamID),
          eq(tasks.type, "weekly"),
          lt(tasks.created_at, arg.CreatedAt),
          or(isNull(tasks.deleted_at), gte(tasks.deleted_at, arg.CreatedAt)),
          lt(
            this.unit.db
              .select({ count: count() })
              .from(taskCompletionWeeklyEntries)
              .where(
                and(
                  eq(taskCompletionWeeklyEntries.task_id, tasks.id),
                  eq(taskCompletionWeeklyEntries.week_start, arg.WeekStart),
                ),
              ),
            tasks.required_completions_per_week,
          ),
        ),
      );
    return required(rows, "SumWeeklyPenaltyForClose").total;
  }
  async SumWeeklyPenaltyForMonth(arg: P.SumWeeklyPenaltyForMonthParams): Promise<number> {
    const rows = await this.unit.read
      .select({ total: totalPenalty })
      .from(closeRuns)
      .innerJoin(
        tasks,
        and(
          eq(tasks.team_id, closeRuns.team_id),
          eq(tasks.type, "weekly"),
          lt(tasks.created_at, weekCloseBoundary),
          or(isNull(tasks.deleted_at), gte(tasks.deleted_at, weekCloseBoundary)),
        ),
      )
      .where(
        and(
          eq(closeRuns.team_id, arg.TeamID),
          eq(closeRuns.scope, "close_week"),
          gte(weekEnd, arg.TargetDate),
          lt(weekEnd, arg.TargetDate_2),
          lt(
            this.unit.db
              .select({ count: count() })
              .from(taskCompletionWeeklyEntries)
              .where(
                and(
                  eq(taskCompletionWeeklyEntries.task_id, tasks.id),
                  eq(taskCompletionWeeklyEntries.week_start, closeRuns.target_date),
                ),
              ),
            tasks.required_completions_per_week,
          ),
        ),
      );
    return required(rows, "SumWeeklyPenaltyForMonth").total;
  }
  async CreateInviteCode(arg: P.CreateInviteCodeParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.CreateInviteCode(arg));
    await this.unit.insert(inviteCodes, {
      code: arg.Code,
      team_id: arg.TeamID,
      expires_at: arg.ExpiresAt,
      created_at: new Date().toISOString(),
    });
  }
  async DeleteInviteCodesByTeamID(teamID: string): Promise<void> {
    if (!this.unit.active)
      return this.transaction((repo) => repo.DeleteInviteCodesByTeamID(teamID));
    await this.unit.remove(inviteCodes, eq(inviteCodes.team_id, teamID));
  }
  async GetInviteCode(code: string): Promise<P.InviteCode> {
    const rows = await this.unit.read
      .select(inviteFields)
      .from(inviteCodes)
      .where(eq(inviteCodes.code, code));
    return required(rows, "GetInviteCode");
  }
  async GetLatestInviteCodeByTeamID(teamID: string): Promise<P.InviteCode> {
    const rows = await this.unit.read
      .select(inviteFields)
      .from(inviteCodes)
      .where(eq(inviteCodes.team_id, teamID))
      .orderBy(desc(inviteCodes.created_at))
      .limit(1);
    return required(rows, "GetLatestInviteCodeByTeamID");
  }
  async ClearTaskAssigneeByTeamAndUser(arg: P.ClearTaskAssigneeByTeamAndUserParams): Promise<void> {
    if (!this.unit.active)
      return this.transaction((repo) => repo.ClearTaskAssigneeByTeamAndUser(arg));
    await this.unit.update(
      tasks,
      and(eq(tasks.team_id, arg.TeamID), eq(tasks.assignee_user_id, arg.Column2))!,
      { assignee_user_id: null },
    );
  }
  async CreateTask(arg: P.CreateTaskParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.CreateTask(arg));
    await this.unit.insert(tasks, {
      id: arg.ID,
      team_id: arg.TeamID,
      title: arg.Title,
      notes: arg.Notes,
      type: arg.Type,
      penalty_points: arg.PenaltyPoints,
      assignee_user_id: arg.Column7 || null,
      required_completions_per_week: arg.RequiredCompletionsPerWeek,
      sort_key: arg.SortKey,
      created_at: arg.CreatedAt,
      updated_at: arg.UpdatedAt,
      deleted_at: null,
    });
  }
  async DeleteTask(id: string): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.DeleteTask(id));
    await this.unit.update(tasks, and(eq(tasks.id, id), isNull(tasks.deleted_at))!, {
      deleted_at: new Date().toISOString(),
    });
  }
  async GetEarliestTaskCreatedAtByTeam(teamID: string): Promise<string> {
    const rows = await this.unit.read
      .select({ createdAt: sql<string>`COALESCE(MIN(${tasks.created_at}), '')` })
      .from(tasks)
      .where(eq(tasks.team_id, teamID));
    return required(rows, "GetEarliestTaskCreatedAtByTeam").createdAt;
  }
  async GetTaskByID(id: string): Promise<P.GetTaskByIDRow> {
    const rows = await this.unit.read.select(taskFields).from(tasks).where(eq(tasks.id, id));
    return required(rows, "GetTaskByID");
  }
  async ListTasksByTeamID(teamID: string): Promise<P.ListTasksByTeamIDRow[]> {
    return this.unit.read
      .select(taskFields)
      .from(tasks)
      .where(and(eq(tasks.team_id, teamID), isNull(tasks.deleted_at)))
      .orderBy(tasks.type, tasks.sort_key, tasks.created_at, tasks.id);
  }
  async ListTasksEffectiveForCloseByTeamAndType(
    arg: P.ListTasksEffectiveForCloseByTeamAndTypeParams,
  ): Promise<P.ListTasksEffectiveForCloseByTeamAndTypeRow[]> {
    return this.unit.read
      .select(taskFields)
      .from(tasks)
      .where(
        and(
          eq(tasks.team_id, arg.TeamID),
          eq(tasks.type, arg.Type),
          lt(tasks.created_at, arg.CreatedAt),
          or(isNull(tasks.deleted_at), gte(tasks.deleted_at, arg.CreatedAt)),
        ),
      )
      .orderBy(tasks.sort_key, tasks.created_at, tasks.id);
  }
  async ListTasksForMonthlyStatusByTeam(
    arg: P.ListTasksForMonthlyStatusByTeamParams,
  ): Promise<P.ListTasksForMonthlyStatusByTeamRow[]> {
    return this.unit.read
      .select(monthlyTaskFields)
      .from(tasks)
      .where(
        and(
          eq(tasks.team_id, arg.TeamID),
          lt(tasks.created_at, arg.CreatedAt),
          or(
            isNull(tasks.deleted_at),
            arg.DeletedAt === null ? sql`FALSE` : gte(tasks.deleted_at, arg.DeletedAt),
          ),
        ),
      )
      .orderBy(tasks.type, tasks.sort_key, tasks.created_at, tasks.id);
  }
  async UpdateTask(arg: P.UpdateTaskParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.UpdateTask(arg));
    await this.unit.update(tasks, eq(tasks.id, arg.ID), {
      title: arg.Title,
      notes: arg.Notes,
      penalty_points: arg.PenaltyPoints,
      assignee_user_id: arg.Column5 || null,
      required_completions_per_week: arg.RequiredCompletionsPerWeek,
      updated_at: arg.UpdatedAt,
    });
  }
  async UpdateTaskSortKey(arg: P.UpdateTaskSortKeyParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.UpdateTaskSortKey(arg));
    await this.unit.update(tasks, eq(tasks.id, arg.ID), {
      sort_key: arg.SortKey,
      updated_at: arg.UpdatedAt,
    });
  }
  async DeactivatePushSubscriptionByEndpoint(
    arg: P.DeactivatePushSubscriptionByEndpointParams,
  ): Promise<number> {
    if (!this.unit.active)
      return this.transaction((repo) => repo.DeactivatePushSubscriptionByEndpoint(arg));
    return this.unit.update(
      pushSubscriptions,
      and(eq(pushSubscriptions.endpoint, arg.Endpoint), eq(pushSubscriptions.is_active, 1))!,
      {
        is_active: 0,
        updated_at: arg.UpdatedAt,
      },
    );
  }
  async DeactivatePushSubscriptionByIDAndUser(
    arg: P.DeactivatePushSubscriptionByIDAndUserParams,
  ): Promise<number> {
    if (!this.unit.active)
      return this.transaction((repo) => repo.DeactivatePushSubscriptionByIDAndUser(arg));
    return this.unit.update(
      pushSubscriptions,
      and(eq(pushSubscriptions.id, arg.ID), eq(pushSubscriptions.user_id, arg.UserID))!,
      {
        is_active: 0,
        updated_at: arg.UpdatedAt,
      },
    );
  }
  async ListActivePushSubscriptionsByTeamID(
    teamID: string,
  ): Promise<P.ListActivePushSubscriptionsByTeamIDRow[]> {
    return this.unit.read
      .select(pushFields)
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.team_id, teamID),
          eq(pushSubscriptions.is_active, 1),
          exists(
            this.unit.db
              .select({ id: teamMembers.user_id })
              .from(teamMembers)
              .where(
                and(
                  eq(teamMembers.team_id, pushSubscriptions.team_id),
                  eq(teamMembers.user_id, pushSubscriptions.user_id),
                ),
              ),
          ),
        ),
      )
      .orderBy(desc(pushSubscriptions.updated_at), desc(pushSubscriptions.id));
  }
  async ListPushSubscriptionsByUserID(
    userID: string,
  ): Promise<P.ListPushSubscriptionsByUserIDRow[]> {
    return this.unit.read
      .select(pushFields)
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.user_id, userID))
      .orderBy(
        desc(pushSubscriptions.is_active),
        desc(pushSubscriptions.updated_at),
        desc(pushSubscriptions.id),
      );
  }
  async ListTeamIDsForPush(): Promise<string[]> {
    const rows = await this.unit.read
      .selectDistinct({ id: pushSubscriptions.team_id })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.is_active, 1),
          exists(
            this.unit.db
              .select({ id: teamMembers.user_id })
              .from(teamMembers)
              .where(
                and(
                  eq(teamMembers.team_id, pushSubscriptions.team_id),
                  eq(teamMembers.user_id, pushSubscriptions.user_id),
                ),
              ),
          ),
        ),
      )
      .orderBy(pushSubscriptions.team_id);
    return rows.map((row) => row.id);
  }
  async UpsertPushSubscription(
    arg: P.UpsertPushSubscriptionParams,
  ): Promise<P.UpsertPushSubscriptionRow> {
    if (!this.unit.active) return this.transaction((repo) => repo.UpsertPushSubscription(arg));
    await this.unit.remove(
      pushSubscriptions,
      and(
        eq(pushSubscriptions.endpoint, arg.Endpoint),
        eq(pushSubscriptions.user_id, arg.UserID),
        ne(pushSubscriptions.team_id, arg.TeamID),
      )!,
    );
    const existing = (await this.ListPushSubscriptionsByUserID(arg.UserID)).find(
      (r) => r.TeamID === arg.TeamID,
    );
    const row = {
      id: existing?.ID ?? arg.ID,
      team_id: arg.TeamID,
      user_id: arg.UserID,
      endpoint: arg.Endpoint,
      p256dh: arg.P256dh,
      auth: arg.Auth,
      user_agent: arg.Column7 || null,
      platform: arg.Platform,
      is_active: 1,
      last_seen_at: arg.LastSeenAt,
      created_at: existing?.CreatedAt ?? arg.CreatedAt,
      updated_at: arg.UpdatedAt,
    };
    if (existing)
      await this.unit.update(pushSubscriptions, eq(pushSubscriptions.id, existing.ID), row);
    else await this.unit.insert(pushSubscriptions, row);
    return (await this.ListPushSubscriptionsByUserID(arg.UserID)).find(
      (r) => r.TeamID === arg.TeamID,
    )!;
  }
  async CreateShoppingItem(arg: P.CreateShoppingItemParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.CreateShoppingItem(arg));
    await this.unit.insert(shoppingItems, {
      id: arg.ID,
      team_id: arg.TeamID,
      name: arg.Name,
      notes: arg.Notes,
      sort_key: arg.SortKey,
      created_at: arg.CreatedAt,
      updated_at: arg.UpdatedAt,
    });
  }
  async DeleteShoppingItem(id: string): Promise<number> {
    if (!this.unit.active) return this.transaction((repo) => repo.DeleteShoppingItem(id));
    return this.unit.remove(shoppingItems, eq(shoppingItems.id, id));
  }
  async GetShoppingItemByID(id: string): Promise<P.ShoppingItem> {
    const rows = await this.unit.read
      .select(shoppingFields)
      .from(shoppingItems)
      .where(eq(shoppingItems.id, id));
    return required(rows, "GetShoppingItemByID");
  }
  async ListShoppingItemsByTeamID(teamID: string): Promise<P.ShoppingItem[]> {
    return this.unit.read
      .select(shoppingFields)
      .from(shoppingItems)
      .where(eq(shoppingItems.team_id, teamID))
      .orderBy(shoppingItems.sort_key, shoppingItems.created_at, shoppingItems.id);
  }
  async UpdateShoppingItem(arg: P.UpdateShoppingItemParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.UpdateShoppingItem(arg));
    await this.unit.update(shoppingItems, eq(shoppingItems.id, arg.ID), {
      name: arg.Name,
      notes: arg.Notes,
      updated_at: arg.UpdatedAt,
    });
  }
  async UpdateShoppingItemSortKey(arg: P.UpdateShoppingItemSortKeyParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.UpdateShoppingItemSortKey(arg));
    await this.unit.update(shoppingItems, eq(shoppingItems.id, arg.ID), {
      sort_key: arg.SortKey,
      updated_at: arg.UpdatedAt,
    });
  }
  async AddTriggeredRuleForMonth(arg: P.AddTriggeredRuleForMonthParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.AddTriggeredRuleForMonth(arg));
    const rows = await this.unit.read
      .select({ id: monthlyPenaltySummaryTriggeredRules.rule_id })
      .from(monthlyPenaltySummaryTriggeredRules)
      .where(
        and(
          eq(monthlyPenaltySummaryTriggeredRules.team_id, arg.TeamID),
          eq(monthlyPenaltySummaryTriggeredRules.month_start, arg.MonthStart),
          eq(monthlyPenaltySummaryTriggeredRules.rule_id, arg.RuleID),
        ),
      )
      .limit(1);
    if (!rows.length)
      await this.unit.insert(monthlyPenaltySummaryTriggeredRules, {
        team_id: arg.TeamID,
        month_start: arg.MonthStart,
        rule_id: arg.RuleID,
        created_at: new Date().toISOString(),
      });
  }
  async CloseMonthlyPenaltySummary(arg: P.CloseMonthlyPenaltySummaryParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.CloseMonthlyPenaltySummary(arg));
    await this.unit.update(
      monthlyPenaltySummaries,
      and(
        eq(monthlyPenaltySummaries.team_id, arg.TeamID),
        eq(monthlyPenaltySummaries.month_start, arg.MonthStart),
      )!,
      { is_closed: 1 },
    );
  }
  async DeleteTriggeredRulesByMonth(arg: P.DeleteTriggeredRulesByMonthParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.DeleteTriggeredRulesByMonth(arg));
    await this.unit.remove(
      monthlyPenaltySummaryTriggeredRules,
      and(
        eq(monthlyPenaltySummaryTriggeredRules.team_id, arg.TeamID),
        eq(monthlyPenaltySummaryTriggeredRules.month_start, arg.MonthStart),
      )!,
    );
  }
  async FindOldestMonthCloseCandidate(
    arg: P.FindOldestMonthCloseCandidateParams,
  ): Promise<P.FindOldestMonthCloseCandidateRow> {
    const rows = await this.unit.all<{ MonthStart: string; PendingMonthCount: number }>(
      sql`SELECT month_start AS MonthStart, COUNT(*) OVER() AS PendingMonthCount FROM eligible ORDER BY month_start LIMIT 1`,
      sql`months(month_start) AS (
 SELECT strftime('%Y-%m-01',MIN(${tasks.created_at}),'+9 hours') FROM ${tasks} WHERE ${tasks.team_id}=${arg.TeamID}
 UNION ALL SELECT date(month_start,'+1 month') FROM months WHERE date(month_start,'+1 month')<${arg.CurrentMonthStart}
), eligible AS (
 SELECT month_start FROM months m WHERE month_start<${arg.CurrentMonthStart}
 AND EXISTS (SELECT 1 FROM ${tasks} WHERE ${tasks.team_id}=${arg.TeamID}
  AND ${tasks.created_at}<strftime('%Y-%m-%dT%H:%M:%fZ',m.month_start,'+1 month','-9 hours')
  AND (${tasks.deleted_at} IS NULL OR ${tasks.deleted_at}>=strftime('%Y-%m-%dT%H:%M:%fZ',m.month_start,'-9 hours')))
 AND NOT EXISTS (SELECT 1 FROM ${monthlyPenaltySummaries} WHERE ${monthlyPenaltySummaries.team_id}=${arg.TeamID} AND ${monthlyPenaltySummaries.month_start}=m.month_start AND ${monthlyPenaltySummaries.is_closed}=1)
)`,
    );
    return required(rows, "FindOldestMonthCloseCandidate");
  }
  async GetMonthlyPenaltySummary(
    arg: P.GetMonthlyPenaltySummaryParams,
  ): Promise<P.MonthlyPenaltySummary> {
    const rows = await this.unit.read
      .select({
        TeamID: monthlyPenaltySummaries.team_id,
        MonthStart: monthlyPenaltySummaries.month_start,
        DailyPenaltyTotal: monthlyPenaltySummaries.daily_penalty_total,
        WeeklyPenaltyTotal: monthlyPenaltySummaries.weekly_penalty_total,
        IsClosed: sql<boolean>`${monthlyPenaltySummaries.is_closed}`.mapWith(Boolean),
      })
      .from(monthlyPenaltySummaries)
      .where(
        and(
          eq(monthlyPenaltySummaries.team_id, arg.TeamID),
          eq(monthlyPenaltySummaries.month_start, arg.MonthStart),
        ),
      );
    return required(rows, "GetMonthlyPenaltySummary");
  }
  async IncrementDailyPenalty(arg: P.IncrementDailyPenaltyParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.IncrementDailyPenalty(arg));
    await this.unit.update(
      monthlyPenaltySummaries,
      and(
        eq(monthlyPenaltySummaries.team_id, arg.TeamID),
        eq(monthlyPenaltySummaries.month_start, arg.MonthStart),
      )!,
      (row) => ({ daily_penalty_total: row.daily_penalty_total + arg.DailyPenaltyTotal }),
    );
  }
  async IncrementWeeklyPenalty(arg: P.IncrementWeeklyPenaltyParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.IncrementWeeklyPenalty(arg));
    await this.unit.update(
      monthlyPenaltySummaries,
      and(
        eq(monthlyPenaltySummaries.team_id, arg.TeamID),
        eq(monthlyPenaltySummaries.month_start, arg.MonthStart),
      )!,
      (row) => ({
        weekly_penalty_total: row.weekly_penalty_total + arg.WeeklyPenaltyTotal,
      }),
    );
  }
  async ListTriggeredRuleIDsByMonth(arg: P.ListTriggeredRuleIDsByMonthParams): Promise<string[]> {
    const rows = await this.unit.read
      .select({ id: monthlyPenaltySummaryTriggeredRules.rule_id })
      .from(monthlyPenaltySummaryTriggeredRules)
      .where(
        and(
          eq(monthlyPenaltySummaryTriggeredRules.team_id, arg.TeamID),
          eq(monthlyPenaltySummaryTriggeredRules.month_start, arg.MonthStart),
        ),
      )
      .orderBy(monthlyPenaltySummaryTriggeredRules.rule_id);
    return rows.map((row) => row.id);
  }
  async SetMonthPenaltyTotals(arg: P.SetMonthPenaltyTotalsParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.SetMonthPenaltyTotals(arg));
    await this.unit.update(
      monthlyPenaltySummaries,
      and(
        eq(monthlyPenaltySummaries.team_id, arg.TeamID),
        eq(monthlyPenaltySummaries.month_start, arg.MonthStart),
      )!,
      { daily_penalty_total: arg.DailyPenaltyTotal, weekly_penalty_total: arg.WeeklyPenaltyTotal },
    );
  }
  async UpsertMonthlyPenaltySummary(arg: P.UpsertMonthlyPenaltySummaryParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.UpsertMonthlyPenaltySummary(arg));
    const row = {
      team_id: arg.TeamID,
      month_start: arg.MonthStart,
      daily_penalty_total: arg.DailyPenaltyTotal,
      weekly_penalty_total: arg.WeeklyPenaltyTotal,
      is_closed: Number(arg.IsClosed),
    };
    const changed = await this.unit.update(
      monthlyPenaltySummaries,
      and(
        eq(monthlyPenaltySummaries.team_id, arg.TeamID),
        eq(monthlyPenaltySummaries.month_start, arg.MonthStart),
      )!,
      row,
    );
    if (!changed) await this.unit.insert(monthlyPenaltySummaries, row);
  }
  async GetLatestCloseRunTargetDate(arg: P.GetLatestCloseRunTargetDateParams): Promise<string> {
    const rows = await this.unit.read
      .select({ date: sql<string>`COALESCE(MAX(${closeRuns.target_date}), '')` })
      .from(closeRuns)
      .where(and(eq(closeRuns.team_id, arg.TeamID), eq(closeRuns.scope, arg.Scope)));
    return required(rows, "GetLatestCloseRunTargetDate").date;
  }
  async InsertCloseRun(arg: P.InsertCloseRunParams): Promise<number> {
    if (!this.unit.active) return this.transaction((repo) => repo.InsertCloseRun(arg));
    const rows = await this.unit.read
      .select({ date: closeRuns.target_date })
      .from(closeRuns)
      .where(
        and(
          eq(closeRuns.team_id, arg.TeamID),
          eq(closeRuns.scope, arg.Scope),
          eq(closeRuns.target_date, arg.TargetDate),
        ),
      )
      .limit(1);
    if (rows.length) return 0;
    await this.unit.insert(closeRuns, {
      team_id: arg.TeamID,
      scope: arg.Scope,
      target_date: arg.TargetDate,
      created_at: new Date().toISOString(),
    });
    return 1;
  }
  async InsertDayCloseRunsForMonth(arg: P.InsertDayCloseRunsForMonthParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.InsertDayCloseRunsForMonth(arg));
    for (let date = arg.MonthStart; date < arg.MonthEnd; date = addDays(date, 1))
      await this.InsertCloseRun({ TeamID: arg.TeamID, Scope: "close_day", TargetDate: date });
  }
  async InsertWeekCloseRunsForMonth(arg: P.InsertWeekCloseRunsForMonthParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.InsertWeekCloseRunsForMonth(arg));
    for (let date = arg.FirstWeekStart; date < arg.MonthEnd; date = addDays(date, 7))
      if (addDays(date, 6) >= arg.MonthStart && addDays(date, 6) < arg.MonthEnd)
        await this.InsertCloseRun({ TeamID: arg.TeamID, Scope: "close_week", TargetDate: date });
  }
  async CreateReminder(arg: P.CreateReminderParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.CreateReminder(arg));
    await this.unit.insert(reminders, {
      id: arg.ID,
      team_id: arg.TeamID,
      title: arg.Title,
      notes: arg.Notes,
      kind: arg.Kind,
      schedule_type: arg.ScheduleType,
      start_date: arg.StartDate,
      end_date: arg.EndDate,
      created_at: arg.CreatedAt,
      updated_at: arg.UpdatedAt,
    });
  }
  async DeleteExpiredOneTimeRemindersByTeam(
    arg: P.DeleteExpiredOneTimeRemindersByTeamParams,
  ): Promise<number> {
    if (!this.unit.active)
      return this.transaction((repo) => repo.DeleteExpiredOneTimeRemindersByTeam(arg));
    return this.unit.remove(
      reminders,
      and(
        eq(reminders.team_id, arg.TeamID),
        eq(reminders.kind, "one_time"),
        lt(reminders.start_date, arg.StartDate),
      )!,
    );
  }
  async DeleteReminder(id: string): Promise<number> {
    if (!this.unit.active) return this.transaction((repo) => repo.DeleteReminder(id));
    return this.unit.remove(reminders, eq(reminders.id, id));
  }
  async GetReminderByID(id: string): Promise<P.Reminder> {
    const rows = await this.unit.read
      .select(reminderFields)
      .from(reminders)
      .where(eq(reminders.id, id));
    return required(rows, "GetReminderByID");
  }
  async ListRemindersByTeamID(teamID: string): Promise<P.Reminder[]> {
    return this.unit.read
      .select(reminderFields)
      .from(reminders)
      .where(eq(reminders.team_id, teamID))
      .orderBy(reminders.created_at, reminders.id);
  }
  async UpdateReminder(arg: P.UpdateReminderParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.UpdateReminder(arg));
    await this.unit.update(reminders, eq(reminders.id, arg.ID), {
      title: arg.Title,
      notes: arg.Notes,
      kind: arg.Kind,
      schedule_type: arg.ScheduleType,
      start_date: arg.StartDate,
      end_date: arg.EndDate,
      updated_at: arg.UpdatedAt,
    });
  }
  async CreatePenaltyRule(arg: P.CreatePenaltyRuleParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.CreatePenaltyRule(arg));
    await this.unit.insert(penaltyRules, {
      id: arg.ID,
      team_id: arg.TeamID,
      threshold: arg.Threshold,
      name: arg.Name,
      description: arg.Description,
      deleted_at: null,
      created_at: arg.CreatedAt,
      updated_at: arg.UpdatedAt,
    });
  }
  async GetUndeletedPenaltyRuleByID(id: string): Promise<P.PenaltyRule> {
    const rows = await this.unit.read
      .select(penaltyFields)
      .from(penaltyRules)
      .where(and(eq(penaltyRules.id, id), isNull(penaltyRules.deleted_at)));
    return required(rows, "GetUndeletedPenaltyRuleByID");
  }
  async ListPenaltyRulesByTeamID(teamID: string): Promise<P.PenaltyRule[]> {
    return this.unit.read
      .select(penaltyFields)
      .from(penaltyRules)
      .where(eq(penaltyRules.team_id, teamID))
      .orderBy(penaltyRules.threshold);
  }
  async ListPenaltyRulesEffectiveAtByTeamID(
    arg: P.ListPenaltyRulesEffectiveAtByTeamIDParams,
  ): Promise<P.PenaltyRule[]> {
    return this.unit.read
      .select(penaltyFields)
      .from(penaltyRules)
      .where(
        and(
          eq(penaltyRules.team_id, arg.TeamID),
          lt(penaltyRules.created_at, arg.AsOf),
          or(isNull(penaltyRules.deleted_at), gte(penaltyRules.deleted_at, arg.AsOf)),
        ),
      )
      .orderBy(penaltyRules.threshold);
  }
  async ListUndeletedPenaltyRulesByTeamID(teamID: string): Promise<P.PenaltyRule[]> {
    return this.unit.read
      .select(penaltyFields)
      .from(penaltyRules)
      .where(and(eq(penaltyRules.team_id, teamID), isNull(penaltyRules.deleted_at)))
      .orderBy(penaltyRules.threshold);
  }
  async SoftDeletePenaltyRule(arg: P.SoftDeletePenaltyRuleParams): Promise<number> {
    if (!this.unit.active) return this.transaction((repo) => repo.SoftDeletePenaltyRule(arg));
    return this.unit.update(
      penaltyRules,
      and(eq(penaltyRules.id, arg.ID), isNull(penaltyRules.deleted_at))!,
      {
        deleted_at: arg.DeletedAt,
        updated_at: arg.DeletedAt,
      },
    );
  }
  async UpdatePenaltyRule(arg: P.UpdatePenaltyRuleParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.UpdatePenaltyRule(arg));
    await this.unit.update(penaltyRules, eq(penaltyRules.id, arg.ID), {
      threshold: arg.Threshold,
      name: arg.Name,
      description: arg.Description,
      updated_at: arg.UpdatedAt,
    });
  }
  async GetUserByID(id: string): Promise<P.GetUserByIDRow> {
    const rows = await this.unit.read
      .select({
        ID: user.id,
        Email: user.email,
        DisplayName: user.name,
        Nickname: emptyText(user.nickname),
        ColorHex: user.colorHex,
        CreatedAt: iso(user.createdAt),
      })
      .from(user)
      .where(eq(user.id, id));
    return required(rows, "GetUserByID");
  }
  async UpdateUserColorHex(arg: P.UpdateUserColorHexParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.UpdateUserColorHex(arg));
    await this.unit.update(user, eq(user.id, arg.ID), {
      colorHex: arg.Column2 || null,
      updatedAt: new Date(),
    });
  }
  async UpdateUserNickname(arg: P.UpdateUserNicknameParams): Promise<void> {
    if (!this.unit.active) return this.transaction((repo) => repo.UpdateUserNickname(arg));
    await this.unit.update(user, eq(user.id, arg.ID), {
      nickname: arg.Column2 || null,
      updatedAt: new Date(),
    });
  }
}
