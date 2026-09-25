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
  type SQL,
} from "drizzle-orm";
import type * as P from "../application/ports";
import { AppError } from "../domain/errors";
import { addDays } from "../domain/dates";
import { summaryStatements } from "./summary-statements";
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
  constructor(
    private readonly db: Database,
    private readonly member?: { teamId: string; userId: string },
  ) {}
  forMember(teamId: string, userId: string): P.Repository {
    return new D1Repository(this.db, { teamId, userId });
  }
  private access() {
    return this.member
      ? sql`EXISTS (SELECT 1 FROM team_members WHERE team_id=${this.member.teamId} AND user_id=${this.member.userId})`
      : sql`1`;
  }
  async GetTaskCompletionWeeklyEntryCount(
    arg: P.GetTaskCompletionWeeklyEntryCountParams,
  ): Promise<number> {
    const rows = await this.db
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
    const rows = await this.db
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
  async ListTaskCompletionDailyByMonthAndTeam(
    arg: P.ListTaskCompletionDailyByMonthAndTeamParams,
  ): Promise<P.ListTaskCompletionDailyByMonthAndTeamRow[]> {
    return this.db
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
          lt(taskCompletionDaily.target_date, arg.BeforeDate),
        ),
      )
      .orderBy(taskCompletionDaily.target_date, taskCompletionDaily.task_id);
  }
  async ListTaskCompletionDailyByTeamAndDate(
    arg: P.ListTaskCompletionDailyByTeamAndDateParams,
  ): Promise<P.ListTaskCompletionDailyByTeamAndDateRow[]> {
    return this.db
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
    return this.db
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
    return this.db
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
          lt(taskCompletionWeeklyEntries.week_start, arg.BeforeWeekStart),
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
    return this.db
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
  async DeleteTeam(id: string): Promise<void> {
    await this.db.batch([
      this.db.update(tasks).set({ assignee_user_id: null }).where(eq(tasks.team_id, id)),
      this.db.delete(tasks).where(eq(tasks.team_id, id)),
      this.db.delete(teams).where(eq(teams.id, id)),
    ]);
  }

  async ListMembershipsByUserID(userID: string): Promise<P.ListMembershipsByUserIDRow[]> {
    return this.db
      .select({ TeamID: teamMembers.team_id, Role: teamMembers.role, TeamName: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.team_id))
      .where(eq(teamMembers.user_id, userID));
  }
  async ListTeamIDsForClose(): Promise<string[]> {
    const rows = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(
        exists(
          this.db
            .select({ id: teamMembers.user_id })
            .from(teamMembers)
            .where(eq(teamMembers.team_id, teams.id)),
        ),
      )
      .orderBy(teams.created_at, teams.id);
    return rows.map((row) => row.id);
  }
  async ListTeamMembersByTeamID(teamID: string): Promise<P.ListTeamMembersByTeamIDRow[]> {
    return this.db
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
  async UpdateTeamName(arg: P.UpdateTeamNameParams): Promise<void> {
    await this.db
      .update(teams)
      .set({ name: arg.Name })
      .where(and(eq(teams.id, arg.ID), this.access()))
      .returning()
      .then((rows) => rows.length);
  }
  async GetInviteCode(code: string): Promise<P.InviteCode> {
    const rows = await this.db
      .select(inviteFields)
      .from(inviteCodes)
      .where(eq(inviteCodes.code, code));
    return required(rows, "GetInviteCode");
  }
  async GetLatestInviteCodeByTeamID(teamID: string): Promise<P.InviteCode> {
    const rows = await this.db
      .select(inviteFields)
      .from(inviteCodes)
      .where(eq(inviteCodes.team_id, teamID))
      .orderBy(desc(inviteCodes.created_at))
      .limit(1);
    return required(rows, "GetLatestInviteCodeByTeamID");
  }
  async CreateTask(arg: P.CreateTaskParams): Promise<void> {
    const assigneeIsMember = arg.AssigneeUserID
      ? sql`EXISTS (
          SELECT 1 FROM team_members
          WHERE team_id = ${arg.TeamID} AND user_id = ${arg.AssigneeUserID}
        )`
      : sql`1`;
    const valid = sql`${this.access()} AND ${assigneeIsMember}`;
    const [, created] = await this.db.batch([
      this.db
        .update(tasks)
        .set({ sort_key: sql`${tasks.sort_key}+100` })
        .where(
          and(
            eq(tasks.team_id, arg.TeamID),
            eq(tasks.type, arg.Type),
            isNull(tasks.deleted_at),
            valid,
          ),
        ),
      this.db
        .insert(tasks)
        .select(
          sql`SELECT ${arg.ID},${arg.TeamID},${arg.Title},${arg.Notes},${arg.Type},${arg.PenaltyPoints},${arg.AssigneeUserID || null},${arg.RequiredCompletionsPerWeek},100,${arg.CreatedAt},${arg.UpdatedAt},NULL WHERE ${valid}`,
        ),
    ]);
    if (!created.meta.changes)
      throw new AppError(
        409,
        "membership_changed",
        "所属または担当者が変わりました。再取得してお試しください。",
      );
  }

  async DeleteTask(id: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({
        deleted_at: new Date().toISOString(),
      })
      .where(and(and(eq(tasks.id, id), isNull(tasks.deleted_at))!, this.access()))
      .returning()
      .then((rows) => rows.length);
  }
  async GetEarliestTaskCreatedAtByTeam(teamID: string): Promise<string> {
    const rows = await this.db
      .select({ createdAt: sql<string>`COALESCE(MIN(${tasks.created_at}), '')` })
      .from(tasks)
      .where(eq(tasks.team_id, teamID));
    return required(rows, "GetEarliestTaskCreatedAtByTeam").createdAt;
  }
  async GetTaskByID(id: string): Promise<P.GetTaskByIDRow> {
    const rows = await this.db.select(taskFields).from(tasks).where(eq(tasks.id, id));
    return required(rows, "GetTaskByID");
  }
  async ListTasksByTeamID(teamID: string): Promise<P.ListTasksByTeamIDRow[]> {
    return this.db
      .select(taskFields)
      .from(tasks)
      .where(and(eq(tasks.team_id, teamID), isNull(tasks.deleted_at)))
      .orderBy(tasks.type, tasks.sort_key, tasks.created_at, tasks.id);
  }
  async ListTasksEffectiveForCloseByTeamAndType(
    arg: P.ListTasksEffectiveForCloseByTeamAndTypeParams,
  ): Promise<P.ListTasksEffectiveForCloseByTeamAndTypeRow[]> {
    return this.db
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
    return this.db
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
    const rows = await this.db
      .update(tasks)
      .set({
        title: arg.Title,
        notes: arg.Notes,
        penalty_points: arg.PenaltyPoints,
        assignee_user_id: arg.AssigneeUserID === undefined ? undefined : arg.AssigneeUserID || null,
        required_completions_per_week: arg.RequiredCompletionsPerWeek,
        updated_at: arg.UpdatedAt,
      })
      .where(
        and(
          eq(tasks.id, arg.ID),
          this.access(),
          arg.AssigneeUserID
            ? sql`EXISTS(SELECT 1 FROM team_members WHERE team_id=${tasks.team_id} AND user_id=${arg.AssigneeUserID})`
            : undefined,
        ),
      )
      .returning();
    if (!rows.length)
      throw new AppError(
        409,
        "task_changed",
        "タスクまたは担当者が変わりました。再取得してお試しください。",
      );
  }
  async DeactivatePushSubscriptionByEndpoint(
    arg: P.DeactivatePushSubscriptionByEndpointParams,
  ): Promise<number> {
    return this.db
      .update(pushSubscriptions)
      .set({
        is_active: 0,
        updated_at: arg.UpdatedAt,
      })
      .where(
        and(
          and(eq(pushSubscriptions.endpoint, arg.Endpoint), eq(pushSubscriptions.is_active, 1))!,
          this.access(),
        ),
      )
      .returning()
      .then((rows) => rows.length);
  }
  async DeactivatePushSubscriptionByIDAndUser(
    arg: P.DeactivatePushSubscriptionByIDAndUserParams,
  ): Promise<number> {
    return this.db
      .update(pushSubscriptions)
      .set({
        is_active: 0,
        updated_at: arg.UpdatedAt,
      })
      .where(
        and(
          and(eq(pushSubscriptions.id, arg.ID), eq(pushSubscriptions.user_id, arg.UserID))!,
          this.access(),
        ),
      )
      .returning()
      .then((rows) => rows.length);
  }
  async ListActivePushSubscriptionsByTeamID(
    teamID: string,
  ): Promise<P.ListActivePushSubscriptionsByTeamIDRow[]> {
    return this.db
      .select(pushFields)
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.team_id, teamID),
          eq(pushSubscriptions.is_active, 1),
          exists(
            this.db
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
    return this.db
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
    const rows = await this.db
      .selectDistinct({ id: pushSubscriptions.team_id })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.is_active, 1),
          exists(
            this.db
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
    await this.db.batch([
      this.db
        .delete(pushSubscriptions)
        .where(
          and(
            and(
              eq(pushSubscriptions.endpoint, arg.Endpoint),
              eq(pushSubscriptions.user_id, arg.UserID),
              ne(pushSubscriptions.team_id, arg.TeamID),
              this.access(),
            ),
            this.access(),
          ),
        ),
      this.db
        .insert(pushSubscriptions)
        .select(
          sql`SELECT ${arg.ID},${arg.TeamID},${arg.UserID},${arg.Endpoint},${arg.P256dh},${arg.Auth},${arg.UserAgent || null},${arg.Platform},1,${arg.LastSeenAt},${arg.CreatedAt},${arg.UpdatedAt} WHERE ${this.access()}`,
        )
        .onConflictDoUpdate({
          target: [pushSubscriptions.team_id, pushSubscriptions.user_id],
          set: {
            endpoint: arg.Endpoint,
            p256dh: arg.P256dh,
            auth: arg.Auth,
            user_agent: arg.UserAgent || null,
            platform: arg.Platform,
            is_active: 1,
            last_seen_at: arg.LastSeenAt,
            updated_at: arg.UpdatedAt,
          },
        }),
    ]);
    return required(
      (await this.ListPushSubscriptionsByUserID(arg.UserID)).filter((r) => r.TeamID === arg.TeamID),
      "UpsertPushSubscription",
    );
  }

  async CreateShoppingItem(arg: P.CreateShoppingItemParams): Promise<void> {
    await this.db.batch([
      this.db
        .update(shoppingItems)
        .set({ sort_key: sql`${shoppingItems.sort_key}+100` })
        .where(and(and(eq(shoppingItems.team_id, arg.TeamID), this.access()), this.access())),
      this.db
        .insert(shoppingItems)
        .select(
          sql`SELECT ${arg.ID},${arg.TeamID},${arg.Name},${arg.Notes},100,${arg.CreatedAt},${arg.UpdatedAt} WHERE ${this.access()}`,
        ),
    ]);
  }

  async DeleteShoppingItem(id: string): Promise<number> {
    return this.db
      .delete(shoppingItems)
      .where(and(eq(shoppingItems.id, id), this.access()))
      .returning()
      .then((rows) => rows.length);
  }
  async GetShoppingItemByID(id: string): Promise<P.ShoppingItem> {
    const rows = await this.db
      .select(shoppingFields)
      .from(shoppingItems)
      .where(eq(shoppingItems.id, id));
    return required(rows, "GetShoppingItemByID");
  }
  async ListShoppingItemsByTeamID(teamID: string): Promise<P.ShoppingItem[]> {
    return this.db
      .select(shoppingFields)
      .from(shoppingItems)
      .where(eq(shoppingItems.team_id, teamID))
      .orderBy(shoppingItems.sort_key, shoppingItems.created_at, shoppingItems.id);
  }
  async UpdateShoppingItem(arg: P.UpdateShoppingItemParams): Promise<void> {
    await this.db
      .update(shoppingItems)
      .set({
        name: arg.Name,
        notes: arg.Notes,
        updated_at: arg.UpdatedAt,
      })
      .where(and(eq(shoppingItems.id, arg.ID), this.access()))
      .returning()
      .then((rows) => rows.length);
  }
  async FindOldestMonthCloseCandidate(
    arg: P.FindOldestMonthCloseCandidateParams,
  ): Promise<P.FindOldestMonthCloseCandidateRow> {
    const rows = await this.db.all<{ MonthStart: string; PendingMonthCount: number }>(
      sql`WITH RECURSIVE months(month_start) AS (
 SELECT strftime('%Y-%m-01',MIN(${tasks.created_at}),'+9 hours') FROM ${tasks} WHERE ${tasks.team_id}=${arg.TeamID}
 UNION ALL SELECT date(month_start,'+1 month') FROM months WHERE date(month_start,'+1 month')<${arg.CurrentMonthStart}
), eligible AS (
 SELECT month_start FROM months m WHERE month_start<${arg.CurrentMonthStart}
 AND EXISTS (SELECT 1 FROM ${tasks} WHERE ${tasks.team_id}=${arg.TeamID}
  AND ${tasks.created_at}<strftime('%Y-%m-%dT%H:%M:%fZ',m.month_start,'+1 month','-9 hours')
  AND (${tasks.deleted_at} IS NULL OR ${tasks.deleted_at}>=strftime('%Y-%m-%dT%H:%M:%fZ',m.month_start,'-9 hours')))
 AND NOT EXISTS (SELECT 1 FROM ${monthlyPenaltySummaries} WHERE ${monthlyPenaltySummaries.team_id}=${arg.TeamID} AND ${monthlyPenaltySummaries.month_start}=m.month_start AND ${monthlyPenaltySummaries.is_closed}=1)
) SELECT month_start AS MonthStart, COUNT(*) OVER() AS PendingMonthCount FROM eligible ORDER BY month_start LIMIT 1`,
    );
    return required(rows, "FindOldestMonthCloseCandidate");
  }
  async GetMonthlyPenaltySummary(
    arg: P.GetMonthlyPenaltySummaryParams,
  ): Promise<P.MonthlyPenaltySummary> {
    const rows = await this.db
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

  async ListTriggeredRuleIDsByMonth(arg: P.ListTriggeredRuleIDsByMonthParams): Promise<string[]> {
    const rows = await this.db
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

  async GetLatestCloseRunTargetDate(arg: P.GetLatestCloseRunTargetDateParams): Promise<string> {
    const rows = await this.db
      .select({ date: sql<string>`COALESCE(MAX(${closeRuns.target_date}), '')` })
      .from(closeRuns)
      .where(and(eq(closeRuns.team_id, arg.TeamID), eq(closeRuns.scope, arg.Scope)));
    return required(rows, "GetLatestCloseRunTargetDate").date;
  }
  async CreateReminder(arg: P.CreateReminderParams): Promise<void> {
    await this.db
      .run(sql`INSERT INTO reminders(id,team_id,title,notes,kind,schedule_type,start_date,end_date,created_at,updated_at)
      SELECT ${arg.ID},${arg.TeamID},${arg.Title},${arg.Notes},${arg.Kind},${arg.ScheduleType},${arg.StartDate},${arg.EndDate},${arg.CreatedAt},${arg.UpdatedAt} WHERE ${this.access()}`);
  }

  async DeleteExpiredOneTimeRemindersByTeam(
    arg: P.DeleteExpiredOneTimeRemindersByTeamParams,
  ): Promise<number> {
    return this.db
      .delete(reminders)
      .where(
        and(
          and(
            eq(reminders.team_id, arg.TeamID),
            eq(reminders.kind, "one_time"),
            lt(reminders.start_date, arg.StartDate),
          )!,
          this.access(),
        ),
      )
      .returning()
      .then((rows) => rows.length);
  }
  async DeleteReminder(id: string): Promise<number> {
    return this.db
      .delete(reminders)
      .where(and(eq(reminders.id, id), this.access()))
      .returning()
      .then((rows) => rows.length);
  }
  async GetReminderByID(id: string): Promise<P.Reminder> {
    const rows = await this.db.select(reminderFields).from(reminders).where(eq(reminders.id, id));
    return required(rows, "GetReminderByID");
  }
  async ListRemindersByTeamID(teamID: string): Promise<P.Reminder[]> {
    return this.db
      .select(reminderFields)
      .from(reminders)
      .where(eq(reminders.team_id, teamID))
      .orderBy(reminders.created_at, reminders.id);
  }
  async UpdateReminder(arg: P.UpdateReminderParams): Promise<void> {
    await this.db
      .update(reminders)
      .set({
        title: arg.Title,
        notes: arg.Notes,
        kind: arg.Kind,
        schedule_type: arg.ScheduleType,
        start_date: arg.StartDate,
        end_date: arg.EndDate,
        updated_at: arg.UpdatedAt,
      })
      .where(and(eq(reminders.id, arg.ID), this.access()))
      .returning()
      .then((rows) => rows.length);
  }
  async CreatePenaltyRule(arg: P.CreatePenaltyRuleParams): Promise<void> {
    await this.db
      .run(sql`INSERT INTO penalty_rules(id,team_id,threshold,name,description,created_at,updated_at)
      SELECT ${arg.ID},${arg.TeamID},${arg.Threshold},${arg.Name},${arg.Description},${arg.CreatedAt},${arg.UpdatedAt} WHERE ${this.access()}`);
  }

  async GetUndeletedPenaltyRuleByID(id: string): Promise<P.PenaltyRule> {
    const rows = await this.db
      .select(penaltyFields)
      .from(penaltyRules)
      .where(and(eq(penaltyRules.id, id), isNull(penaltyRules.deleted_at)));
    return required(rows, "GetUndeletedPenaltyRuleByID");
  }
  async ListPenaltyRulesByTeamID(teamID: string): Promise<P.PenaltyRule[]> {
    return this.db
      .select(penaltyFields)
      .from(penaltyRules)
      .where(eq(penaltyRules.team_id, teamID))
      .orderBy(penaltyRules.threshold);
  }
  async ListPenaltyRulesEffectiveAtByTeamID(
    arg: P.ListPenaltyRulesEffectiveAtByTeamIDParams,
  ): Promise<P.PenaltyRule[]> {
    return this.db
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
    return this.db
      .select(penaltyFields)
      .from(penaltyRules)
      .where(and(eq(penaltyRules.team_id, teamID), isNull(penaltyRules.deleted_at)))
      .orderBy(penaltyRules.threshold);
  }
  async SoftDeletePenaltyRule(arg: P.SoftDeletePenaltyRuleParams): Promise<number> {
    return this.db
      .update(penaltyRules)
      .set({
        deleted_at: arg.DeletedAt,
        updated_at: arg.DeletedAt,
      })
      .where(and(and(eq(penaltyRules.id, arg.ID), isNull(penaltyRules.deleted_at))!, this.access()))
      .returning()
      .then((rows) => rows.length);
  }
  async UpdatePenaltyRule(arg: P.UpdatePenaltyRuleParams): Promise<void> {
    await this.db
      .update(penaltyRules)
      .set({
        threshold: arg.Threshold,
        name: arg.Name,
        description: arg.Description,
        updated_at: arg.UpdatedAt,
      })
      .where(and(eq(penaltyRules.id, arg.ID), this.access()))
      .returning()
      .then((rows) => rows.length);
  }
  async GetUserByID(id: string): Promise<P.GetUserByIDRow> {
    const rows = await this.db
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
    await this.db
      .update(user)
      .set({
        colorHex: arg.ColorHex || null,
        updatedAt: new Date(),
      })
      .where(and(eq(user.id, arg.ID), this.access()))
      .returning()
      .then((rows) => rows.length);
  }
  async UpdateUserNickname(arg: P.UpdateUserNicknameParams): Promise<void> {
    await this.db
      .update(user)
      .set({
        nickname: arg.Nickname || null,
        updatedAt: new Date(),
      })
      .where(and(eq(user.id, arg.ID), this.access()))
      .returning()
      .then((rows) => rows.length);
  }
  async ProvisionUser(userId: string, teamId: string, name: string, now: string): Promise<void> {
    await this.db.batch([
      this.db.insert(teams).select(sql`SELECT ${teamId},${name},${now}
        WHERE NOT EXISTS(SELECT 1 FROM team_members WHERE user_id=${userId})`),
      this.db.insert(teamMembers).select(sql`SELECT ${teamId},${userId},'owner',${now}
        WHERE EXISTS(SELECT 1 FROM teams WHERE id=${teamId}) AND NOT EXISTS(SELECT 1 FROM team_members WHERE user_id=${userId})`),
    ]);
  }
  async MoveMember(arg: P.MoveMemberParams): Promise<void> {
    const currentMembership = sql`EXISTS (
      SELECT 1 FROM team_members
      WHERE team_id = ${arg.fromTeamId} AND user_id = ${arg.userId}
    )`;
    const validInvite = arg.inviteCode
      ? sql`EXISTS (
          SELECT 1 FROM invite_codes
          WHERE code = ${arg.inviteCode} AND team_id = ${arg.toTeamId} AND expires_at >= ${arg.now}
        )`
      : sql`1`;
    const valid = sql`${currentMembership} AND ${validInvite}`;
    // 所属の移動、担当解除、owner引継ぎ、空チーム削除を一度にcommitする。
    const [, , , membershipUpdate] = await this.db.batch([
      this.db
        .insert(teams)
        .select(
          sql`SELECT ${arg.toTeamId},${arg.newTeamName ?? ""},${arg.now} WHERE ${!arg.inviteCode} AND ${valid}`,
        ),
      this.db
        .update(tasks)
        .set({ assignee_user_id: null })
        .where(
          and(eq(tasks.team_id, arg.fromTeamId), eq(tasks.assignee_user_id, arg.userId), valid),
        ),
      this.db
        .update(pushSubscriptions)
        .set({ is_active: 0, updated_at: arg.now })
        .where(
          and(
            eq(pushSubscriptions.team_id, arg.fromTeamId),
            eq(pushSubscriptions.user_id, arg.userId),
            valid,
          ),
        ),
      this.db
        .update(teamMembers)
        .set({
          team_id: arg.toTeamId,
          role: arg.inviteCode ? "member" : "owner",
          created_at: arg.now,
        })
        .where(
          and(eq(teamMembers.team_id, arg.fromTeamId), eq(teamMembers.user_id, arg.userId), valid),
        ),
      this.db.update(teamMembers).set({ role: "owner" }).where(sql` team_id=${arg.fromTeamId}
        AND user_id=(SELECT user_id FROM team_members WHERE team_id=${arg.fromTeamId} ORDER BY created_at,user_id LIMIT 1)
        AND NOT EXISTS(SELECT 1 FROM team_members WHERE team_id=${arg.fromTeamId} AND role='owner')`),
      this.db
        .delete(teams)
        .where(
          and(
            eq(teams.id, arg.fromTeamId),
            sql`NOT EXISTS(SELECT 1 FROM team_members WHERE team_id=${arg.fromTeamId})`,
          ),
        ),
    ]);
    if (!membershipUpdate.meta.changes)
      throw new AppError(
        409,
        "membership_changed",
        "所属または招待コードが変わりました。再取得してお試しください。",
      );
  }
  async ReplaceInvite(arg: P.CreateInviteCodeParams, userId: string): Promise<void> {
    const owner = sql`EXISTS(SELECT 1 FROM team_members WHERE team_id=${arg.TeamID} AND user_id=${userId} AND role='owner')`;
    const [, result] = await this.db.batch([
      this.db
        .delete(inviteCodes)
        .where(and(eq(inviteCodes.team_id, arg.TeamID), owner, this.access())),
      this.db
        .insert(inviteCodes)
        .select(
          sql`SELECT ${arg.Code},${arg.TeamID},${arg.ExpiresAt},strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ${owner}`,
        ),
    ]);
    if (!result.meta.changes) throw new AppError(403, "forbidden", "owner role required");
  }
  async Reorder(arg: P.ReorderParams): Promise<void> {
    if (!arg.ids.length) return;
    const table = arg.kind === "tasks" ? tasks : shoppingItems;
    const ids = JSON.stringify(arg.ids);
    const scope = and(
      eq(table.team_id, arg.teamId),
      arg.kind === "tasks" ? and(eq(tasks.type, arg.type), isNull(tasks.deleted_at)) : undefined,
    );
    // 件数・対象IDが保存時点でも一致するときだけ全行を更新する。
    const valid = sql`(SELECT COUNT(*) FROM ${table} WHERE ${scope})=${arg.ids.length}
      AND (SELECT COUNT(*) FROM ${table} WHERE ${scope} AND ${table.id} IN (SELECT value FROM json_each(${ids})))=${arg.ids.length}`;
    const rows = await this.db
      .update(table)
      .set({
        sort_key: sql`(SELECT (CAST(key AS INTEGER)+1)*100 FROM json_each(${ids}) WHERE value=${table.id})`,
        updated_at: arg.now,
      })
      .where(and(scope, this.access(), valid))
      .returning({ id: table.id });
    if (rows.length !== arg.ids.length)
      throw new AppError(409, "items_changed", "一覧が変わりました。再取得してお試しください。");
  }
  /** 単発は状態の指定、複数回はDBの現在件数に対する加減算として保存する。 */
  private completionChange(arg: P.SetCompletionParams, allowed: SQL) {
    const adding = arg.action === "complete" || arg.action === "increment";
    if (arg.type === "daily") {
      if (adding) {
        return this.db
          .insert(taskCompletionDaily)
          .select(sql`
            SELECT ${arg.taskId}, ${arg.target}, ${arg.userId}, ${arg.now}
            WHERE ${allowed}
          `)
          .onConflictDoNothing();
      }
      return this.db.delete(taskCompletionDaily).where(sql`
        task_id = ${arg.taskId} AND target_date = ${arg.target} AND ${allowed}
      `);
    }

    if (adding) {
      return this.db.insert(taskCompletionWeeklyEntries).select(sql`
        SELECT ${crypto.randomUUID()}, ${arg.taskId}, ${arg.target}, ${arg.userId}, ${arg.now}
        WHERE ${allowed}
          AND (
            SELECT COUNT(*) FROM task_completion_weekly_entries
            WHERE task_id = ${arg.taskId} AND week_start = ${arg.target}
          ) < (SELECT required_completions_per_week FROM tasks WHERE id = ${arg.taskId})
      `);
    }
    // 取消は新しい完了記録から1件だけ削除する。
    return this.db.delete(taskCompletionWeeklyEntries).where(sql`
      id = (
        SELECT id FROM task_completion_weekly_entries
        WHERE task_id = ${arg.taskId} AND week_start = ${arg.target}
        ORDER BY created_at DESC, id DESC LIMIT 1
      ) AND ${allowed}
    `);
  }

  async SetCompletion(arg: P.SetCompletionParams): Promise<number> {
    const settingWeeklyState =
      arg.type === "weekly" && (arg.action === "complete" || arg.action === "incomplete");
    const singleCompletionRequired = settingWeeklyState
      ? sql`(SELECT required_completions_per_week FROM tasks WHERE id = ${arg.taskId}) = 1`
      : sql`1`;
    // 読み取り後に所属・回数設定が変わっても、更新時点のDBで条件を再確認する。
    const allowed = sql`
      EXISTS (
        SELECT 1 FROM tasks
        WHERE id = ${arg.taskId} AND team_id = ${arg.teamId} AND type = ${arg.type}
          AND created_at < ${arg.cutoff}
          AND (deleted_at IS NULL OR deleted_at >= ${arg.cutoff})
      ) AND ${this.access()} AND ${singleCompletionRequired}
    `;
    const change = this.completionChange(arg, allowed);
    const summaries = arg.recalculateMonth
      ? summaryStatements(this.db, {
          teamId: arg.teamId,
          month: arg.recalculateMonth,
          ensureCoverage: arg.ensureCoverage,
          access: this.access(),
        })
      : [];
    const table = arg.type === "daily" ? taskCompletionDaily : taskCompletionWeeklyEntries;
    const target =
      arg.type === "daily"
        ? taskCompletionDaily.target_date
        : taskCompletionWeeklyEntries.week_start;
    const countCompletions = this.db
      .select({ count: count() })
      .from(table)
      .where(and(eq(table.task_id, arg.taskId), eq(target, arg.target)));

    // 完了変更・過去集計・結果の件数取得を同じbatchで確定する。
    const results = await this.db.batch([change, ...summaries, countCompletions]);
    // 集計SQLの数が可変でも、最後は必ずcountCompletionsの結果。
    const rows = results.at(-1) as Awaited<typeof countCompletions>;
    return rows[0].count;
  }
  async RecalculateMonth(arg: P.RecalculateMonthParams): Promise<void> {
    const statements = summaryStatements(this.db, { ...arg, access: this.access() });
    await this.db.batch(statements);
  }
  async ClosePeriod(teamId: string, scope: "day" | "week", date: string): Promise<boolean> {
    const month = (scope === "day" ? date : addDays(date, 6)).slice(0, 7);
    const monthIsOpen = sql`NOT EXISTS (
      SELECT 1 FROM monthly_penalty_summaries
      WHERE team_id = ${teamId} AND month_start = ${month + "-01"} AND is_closed = 1
    )`;
    const [result] = await this.db.batch([
      this.db
        .insert(closeRuns)
        .select(sql`
          SELECT ${teamId}, ${scope === "day" ? "close_day" : "close_week"}, ${date},
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE ${monthIsOpen}
        `)
        .onConflictDoNothing(),
      ...summaryStatements(this.db, {
        teamId,
        month,
        ensureCoverage: false,
        access: monthIsOpen,
      }),
    ]);
    return result.meta.changes > 0;
  }
}
