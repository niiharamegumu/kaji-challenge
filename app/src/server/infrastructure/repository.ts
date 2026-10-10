import {
  and,
  eq,
  ne,
  lt,
  lte,
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
  todoItems,
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
const todoFields = {
  CategoryID: todoItems.category_id,
  ID: todoItems.id,
  TeamID: todoItems.team_id,
  Name: todoItems.name,
  Notes: todoItems.notes,
  SortKey: todoItems.sort_key,
  CreatedAt: iso(todoItems.created_at),
  UpdatedAt: iso(todoItems.updated_at),
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
    private readonly authorization?:
      | { sessionId: string; userId: string }
      | {
          connectionId: string;
          userId: string;
          scope: string;
          // UTC ISO expiry from the provider-verified principal, never request input.
          tokenExpiresAt: string;
        },
  ) {}
  forSession(userId: string, sessionId: string): P.Repository {
    if (this.member || this.authorization) throw new AppError(403, "forbidden", "Already scoped");
    return new D1Repository(this.db, undefined, { userId, sessionId });
  }
  forMember(teamId: string, userId: string): P.Repository {
    if (this.member && (this.member.teamId !== teamId || this.member.userId !== userId))
      throw new AppError(403, "forbidden", "Cannot change repository identity");
    return new D1Repository(this.db, { teamId, userId }, this.authorization);
  }
  private membershipAccess() {
    return this.member
      ? sql`EXISTS (SELECT 1 FROM team_members WHERE team_id=${this.member.teamId} AND user_id=${this.member.userId})`
      : sql`1`;
  }
  private authentication() {
    if (!this.authorization) return sql`1`;
    const authorization = this.authorization;
    const actor = this.member ? sql`${this.member.userId}=${authorization.userId}` : sql`1`;
    if ("sessionId" in authorization)
      return sql`(${actor}) AND EXISTS (
        SELECT 1 FROM auth_session WHERE id=${authorization.sessionId} AND user_id=${authorization.userId}
          AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      )`;
    return sql`(${actor}) AND EXISTS (
      SELECT 1 FROM mcp_connections AS mcp
      WHERE mcp.id=${authorization.connectionId} AND mcp.user_id=${authorization.userId}
        AND mcp.grant_id IS NOT NULL AND length(mcp.grant_id)>0
        AND mcp.revoked_at IS NULL AND mcp.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND ${authorization.tokenExpiresAt}>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND EXISTS (SELECT 1 FROM json_each(mcp.scopes)
          WHERE type='text' AND value=${authorization.scope})
    )`;
  }
  private access() {
    return sql`(${this.membershipAccess()}) AND (${this.authentication()})`;
  }
  private identityAccess(userId: string | SQLWrapper) {
    const actor = this.authorization?.userId ?? this.member?.userId;
    return sql`(${this.authentication()}) AND (${actor === undefined ? sql`1` : sql`${userId}=${actor}`})`;
  }
  private teamAccess(teamId: string | SQLWrapper) {
    // Authenticated requests resolve membership before team data access. Only trusted
    // jobs/bootstrap use the unscoped repository to span teams.
    return and(
      this.access(),
      this.member ? sql`${teamId}=${this.member.teamId}` : this.authorization ? sql`0` : sql`1`,
    )!;
  }
  private taskAccess(taskId: string | SQLWrapper) {
    return sql`EXISTS (SELECT 1 FROM tasks WHERE id=${taskId} AND ${this.teamAccess(tasks.team_id)})`;
  }
  private requireSystemAccess() {
    if (this.member || this.authorization)
      throw new AppError(403, "forbidden", "System operation required");
  }
  async assertAccess(): Promise<void> {
    const row = await this.db.get<{ authenticated: number; member: number }>(sql`
      SELECT ${this.authentication()} AS authenticated, ${this.membershipAccess()} AS member
    `);
    if (!row?.authenticated) throw new AppError(401, "unauthorized", "認証が失効しています。");
    if (!row.member)
      throw new AppError(403, "forbidden", "所属が変わりました。再取得してください。");
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
          this.taskAccess(taskCompletionWeeklyEntries.task_id),
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
          this.taskAccess(taskCompletionDaily.task_id),
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
          this.teamAccess(tasks.team_id),
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
          this.teamAccess(tasks.team_id),
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
          this.teamAccess(tasks.team_id),
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
          this.teamAccess(tasks.team_id),
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
          this.teamAccess(tasks.team_id),
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
    this.requireSystemAccess();
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
      .where(and(eq(teamMembers.user_id, userID), this.identityAccess(teamMembers.user_id)));
  }
  async ListTeamIDsForClose(): Promise<string[]> {
    this.requireSystemAccess();
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
      .where(and(eq(teamMembers.team_id, teamID), this.teamAccess(teamMembers.team_id)))
      .orderBy(teamMembers.created_at);
  }
  async UpdateTeamName(arg: P.UpdateTeamNameParams): Promise<void> {
    await this.db
      .update(teams)
      .set({ name: arg.Name })
      .where(and(eq(teams.id, arg.ID), this.teamAccess(teams.id)))
      .returning()
      .then((rows) => rows.length);
  }
  async GetInviteCode(code: string): Promise<P.InviteCode> {
    const rows = await this.db
      .select(inviteFields)
      .from(inviteCodes)
      // The invite is the capability for joining another team. MoveMember rechecks it.
      .where(and(eq(inviteCodes.code, code), this.access()));
    return required(rows, "GetInviteCode");
  }
  async GetLatestInviteCodeByTeamID(teamID: string): Promise<P.InviteCode> {
    const rows = await this.db
      .select(inviteFields)
      .from(inviteCodes)
      .where(and(eq(inviteCodes.team_id, teamID), this.teamAccess(inviteCodes.team_id)))
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
    const valid = sql`${this.teamAccess(arg.TeamID)} AND ${assigneeIsMember}`;
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
      .where(and(eq(tasks.id, id), isNull(tasks.deleted_at), this.teamAccess(tasks.team_id)))
      .returning()
      .then((rows) => rows.length);
  }
  async GetEarliestTaskCreatedAtByTeam(teamID: string): Promise<string> {
    const rows = await this.db
      .select({ createdAt: sql<string>`COALESCE(MIN(${tasks.created_at}), '')` })
      .from(tasks)
      .where(and(eq(tasks.team_id, teamID), this.teamAccess(tasks.team_id)));
    return required(rows, "GetEarliestTaskCreatedAtByTeam").createdAt;
  }
  async GetTaskByID(id: string): Promise<P.GetTaskByIDRow> {
    const rows = await this.db
      .select(taskFields)
      .from(tasks)
      .where(and(eq(tasks.id, id), this.teamAccess(tasks.team_id)));
    return required(rows, "GetTaskByID");
  }
  async ListTasksByTeamID(teamID: string): Promise<P.ListTasksByTeamIDRow[]> {
    return this.db
      .select(taskFields)
      .from(tasks)
      .where(
        and(eq(tasks.team_id, teamID), isNull(tasks.deleted_at), this.teamAccess(tasks.team_id)),
      )
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
          this.teamAccess(tasks.team_id),
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
          this.teamAccess(tasks.team_id),
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
          this.teamAccess(tasks.team_id),
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
    this.requireSystemAccess();
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
          this.teamAccess(pushSubscriptions.team_id),
          this.identityAccess(pushSubscriptions.user_id),
        ),
      )
      .returning()
      .then((rows) => rows.length);
  }
  async ListActivePushSubscriptionsByTeamID(
    teamID: string,
  ): Promise<P.ListActivePushSubscriptionsByTeamIDRow[]> {
    this.requireSystemAccess();
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
      .where(
        and(
          eq(pushSubscriptions.user_id, userID),
          this.identityAccess(pushSubscriptions.user_id),
          this.teamAccess(pushSubscriptions.team_id),
        ),
      )
      .orderBy(
        desc(pushSubscriptions.is_active),
        desc(pushSubscriptions.updated_at),
        desc(pushSubscriptions.id),
      );
  }
  async ListTeamIDsForPush(): Promise<string[]> {
    this.requireSystemAccess();
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
    const allowed = and(this.teamAccess(arg.TeamID), this.identityAccess(arg.UserID))!;
    await this.db.batch([
      this.db.delete(pushSubscriptions).where(
        and(
          eq(pushSubscriptions.endpoint, arg.Endpoint),
          eq(pushSubscriptions.user_id, arg.UserID),
          ne(pushSubscriptions.team_id, arg.TeamID),
          // A new registration may replace only this user's inactive old device
          // record. It cannot remove an active subscription in another team.
          this.member ? eq(pushSubscriptions.is_active, 0) : undefined,
          allowed,
        ),
      ),
      this.db
        .insert(pushSubscriptions)
        .select(
          sql`SELECT ${arg.ID},${arg.TeamID},${arg.UserID},${arg.Endpoint},${arg.P256dh},${arg.Auth},${arg.UserAgent || null},${arg.Platform},1,${arg.LastSeenAt},${arg.CreatedAt},${arg.UpdatedAt} WHERE ${allowed}`,
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

  async CreateTodoCategory(teamId: string, category: P.TodoCategory): Promise<void> {
    // An empty registry defaults to unclassified first. New teams store [null] explicitly.
    // Preserve the existing ID when the same name is submitted twice.
    await this.db
      .update(teams)
      .set({
        todo_categories: sql`json_insert(
        CASE WHEN json_array_length(${teams.todo_categories})=0 THEN '[null]' ELSE ${teams.todo_categories} END,
        '$[#]', json(${JSON.stringify(category)})
      )`,
      })
      .where(
        and(
          eq(teams.id, teamId),
          this.teamAccess(teams.id),
          sql`NOT EXISTS (SELECT 1 FROM json_each(${teams.todo_categories}) WHERE json_extract(value, '$.name')=${category.name})`,
        ),
      );
  }
  async RenameTodoCategory(teamId: string, categoryId: string, name: string): Promise<boolean> {
    // Resolve the current array position and check uniqueness in the same write.
    const rows = await this.db
      .update(teams)
      .set({
        todo_categories: sql`json_set(${teams.todo_categories},
          (SELECT '$[' || key || '].name' FROM json_each(${teams.todo_categories})
            WHERE json_extract(value, '$.id')=${categoryId}), ${name})`,
      })
      .where(
        and(
          eq(teams.id, teamId),
          this.teamAccess(teams.id),
          sql`EXISTS (SELECT 1 FROM json_each(${teams.todo_categories})
            WHERE json_extract(value, '$.id')=${categoryId})`,
          sql`NOT EXISTS (SELECT 1 FROM json_each(${teams.todo_categories})
            WHERE json_extract(value, '$.id')<>${categoryId}
              AND json_extract(value, '$.name')=${name})`,
        ),
      )
      .returning({ id: teams.id });
    return rows.length === 1;
  }
  async ListTodoCategories(teamId: string): Promise<(P.TodoCategory | null)[]> {
    const rows = await this.db
      .select({ categories: teams.todo_categories })
      .from(teams)
      .where(and(eq(teams.id, teamId), this.teamAccess(teams.id)));
    const { categories } = required(rows, "ListTodoCategories");
    return categories.length === 0 ? [null] : categories;
  }
  async ReorderTodoCategories(teamId: string, categoryIds: (string | null)[]): Promise<boolean> {
    const ids = categoryIds.filter((id) => id !== null);
    // Join by ID to preserve the current name, including renames made during a drag.
    // Compare the complete ID set in the same statement to reject stale add/delete lists.
    const rows = await this.db
      .update(teams)
      .set({
        todo_categories: sql`(SELECT json_group_array(json(value)) FROM (
        SELECT current.value FROM json_each(${JSON.stringify(categoryIds)}) AS requested
        LEFT JOIN json_each(${teams.todo_categories}) AS current
          ON requested.value = json_extract(current.value, '$.id')
        ORDER BY requested.key
      ))`,
      })
      .where(
        and(
          eq(teams.id, teamId),
          this.teamAccess(teams.id),
          sql`(SELECT COUNT(*) FROM json_each(${teams.todo_categories}) WHERE type <> 'null') = ${ids.length}`,
          sql`NOT EXISTS (
        SELECT 1 FROM json_each(${teams.todo_categories}) AS current WHERE current.type <> 'null'
        AND NOT EXISTS (SELECT 1 FROM json_each(${JSON.stringify(ids)}) AS requested
          WHERE requested.value = json_extract(current.value, '$.id'))
      )`,
        ),
      )
      .returning({ id: teams.id });
    return rows.length === 1;
  }
  async DeleteTodoCategory(teamId: string, categoryId: string, now: string): Promise<boolean> {
    const allowed = and(this.teamAccess(teamId), this.todoCategoryExists(teamId, categoryId))!;
    const [, deleted] = await this.db.batch([
      this.db
        .update(todoItems)
        .set({ category_id: null, updated_at: now })
        .where(and(eq(todoItems.team_id, teamId), eq(todoItems.category_id, categoryId), allowed)),
      this.db
        .update(teams)
        .set({
          todo_categories: sql`(SELECT json_group_array(json(value)) FROM (
          SELECT value FROM json_each(${teams.todo_categories})
          WHERE json_extract(value, '$.id') IS NOT ${categoryId} ORDER BY key
        ))`,
        })
        .where(and(eq(teams.id, teamId), allowed))
        .returning({ id: teams.id }),
    ]);
    return deleted.length === 1;
  }

  private todoCategoryExists(teamId: string, categoryId: string | null | undefined) {
    return categoryId == null
      ? sql`1`
      : sql`EXISTS (
      SELECT 1 FROM ${teams}, json_each(${teams.todo_categories}) AS category
      WHERE ${teams.id}=${teamId} AND json_extract(category.value, '$.id')=${categoryId}
    )`;
  }

  async CreateTodoItem(arg: P.CreateTodoItemParams): Promise<boolean> {
    const allowed = and(
      this.teamAccess(arg.TeamID),
      this.todoCategoryExists(arg.TeamID, arg.CategoryID),
    );
    const [, inserted] = await this.db.batch([
      this.db
        .update(todoItems)
        .set({ sort_key: sql`${todoItems.sort_key}+100` })
        .where(and(eq(todoItems.team_id, arg.TeamID), allowed)),
      this.db
        .insert(todoItems)
        .select(
          sql`SELECT ${arg.ID},${arg.TeamID},${arg.Name},${arg.Notes},${arg.CategoryID},100,${arg.CreatedAt},${arg.UpdatedAt} WHERE ${allowed}`,
        )
        .returning({ id: todoItems.id }),
    ]);
    return inserted.length === 1;
  }

  async DeleteTodoItem(id: string): Promise<number> {
    return this.db
      .delete(todoItems)
      .where(and(eq(todoItems.id, id), this.teamAccess(todoItems.team_id)))
      .returning()
      .then((rows) => rows.length);
  }
  async GetTodoItemByID(id: string): Promise<P.TodoItem> {
    const rows = await this.db
      .select(todoFields)
      .from(todoItems)
      .where(and(eq(todoItems.id, id), this.teamAccess(todoItems.team_id)));
    return required(rows, "GetTodoItemByID");
  }
  async ListTodoItemsByTeamID(teamID: string): Promise<P.TodoItem[]> {
    return this.db
      .select(todoFields)
      .from(todoItems)
      .where(and(eq(todoItems.team_id, teamID), this.teamAccess(todoItems.team_id)))
      .orderBy(todoItems.sort_key, todoItems.created_at, todoItems.id);
  }
  async UpdateTodoItem(arg: P.UpdateTodoItemParams): Promise<boolean> {
    const rows = await this.db
      .update(todoItems)
      .set({
        name: arg.Name,
        notes: arg.Notes,
        category_id: arg.CategoryID,
        updated_at: arg.UpdatedAt,
      })
      .where(
        and(
          eq(todoItems.id, arg.ID),
          eq(todoItems.team_id, arg.TeamID),
          this.teamAccess(todoItems.team_id),
          this.todoCategoryExists(arg.TeamID, arg.CategoryID),
        ),
      )
      .returning({ id: todoItems.id });
    return rows.length === 1;
  }
  async FindOldestMonthCloseCandidate(
    arg: P.FindOldestMonthCloseCandidateParams,
  ): Promise<P.FindOldestMonthCloseCandidateRow> {
    const rows = await this.db.all<{ MonthStart: string; PendingMonthCount: number }>(
      sql`WITH RECURSIVE months(month_start) AS (
 SELECT strftime('%Y-%m-01',MIN(${tasks.created_at}),'+9 hours') FROM ${tasks} WHERE ${tasks.team_id}=${arg.TeamID} AND ${this.teamAccess(tasks.team_id)}
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
          this.teamAccess(monthlyPenaltySummaries.team_id),
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
          this.teamAccess(monthlyPenaltySummaryTriggeredRules.team_id),
        ),
      )
      .orderBy(monthlyPenaltySummaryTriggeredRules.rule_id);
    return rows.map((row) => row.id);
  }

  async GetLatestCloseRunTargetDate(arg: P.GetLatestCloseRunTargetDateParams): Promise<string> {
    const rows = await this.db
      .select({ date: sql<string>`COALESCE(MAX(${closeRuns.target_date}), '')` })
      .from(closeRuns)
      .where(
        and(
          eq(closeRuns.team_id, arg.TeamID),
          eq(closeRuns.scope, arg.Scope),
          this.teamAccess(closeRuns.team_id),
        ),
      );
    return required(rows, "GetLatestCloseRunTargetDate").date;
  }
  async CreateReminder(arg: P.CreateReminderParams): Promise<void> {
    await this.db
      .run(sql`INSERT INTO reminders(id,team_id,title,notes,kind,schedule_type,start_date,end_date,created_at,updated_at)
      SELECT ${arg.ID},${arg.TeamID},${arg.Title},${arg.Notes},${arg.Kind},${arg.ScheduleType},${arg.StartDate},${arg.EndDate},${arg.CreatedAt},${arg.UpdatedAt} WHERE ${this.teamAccess(arg.TeamID)}`);
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
          this.teamAccess(reminders.team_id),
        ),
      )
      .returning()
      .then((rows) => rows.length);
  }
  async DeleteReminder(id: string): Promise<number> {
    return this.db
      .delete(reminders)
      .where(and(eq(reminders.id, id), this.teamAccess(reminders.team_id)))
      .returning()
      .then((rows) => rows.length);
  }
  async GetReminderByID(id: string): Promise<P.Reminder> {
    const rows = await this.db
      .select(reminderFields)
      .from(reminders)
      .where(and(eq(reminders.id, id), this.teamAccess(reminders.team_id)));
    return required(rows, "GetReminderByID");
  }
  async ListRemindersByTeamID(teamID: string, period?: P.ReminderPeriod): Promise<P.Reminder[]> {
    return this.db
      .select(reminderFields)
      .from(reminders)
      .where(
        and(
          eq(reminders.team_id, teamID),
          this.teamAccess(reminders.team_id),
          period
            ? and(
                lte(reminders.start_date, period.to),
                or(isNull(reminders.end_date), gte(reminders.end_date, period.from)),
                or(
                  eq(reminders.kind, "recurring"),
                  gte(
                    reminders.start_date,
                    period.from > period.today ? period.from : period.today,
                  ),
                ),
              )
            : undefined,
        ),
      )
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
      .where(and(eq(reminders.id, arg.ID), this.teamAccess(reminders.team_id)))
      .returning()
      .then((rows) => rows.length);
  }
  async CreatePenaltyRule(arg: P.CreatePenaltyRuleParams): Promise<void> {
    await this.db
      .run(sql`INSERT INTO penalty_rules(id,team_id,threshold,name,description,created_at,updated_at)
      SELECT ${arg.ID},${arg.TeamID},${arg.Threshold},${arg.Name},${arg.Description},${arg.CreatedAt},${arg.UpdatedAt} WHERE ${this.teamAccess(arg.TeamID)}`);
  }

  async GetUndeletedPenaltyRuleByID(id: string): Promise<P.PenaltyRule> {
    const rows = await this.db
      .select(penaltyFields)
      .from(penaltyRules)
      .where(
        and(
          eq(penaltyRules.id, id),
          isNull(penaltyRules.deleted_at),
          this.teamAccess(penaltyRules.team_id),
        ),
      );
    return required(rows, "GetUndeletedPenaltyRuleByID");
  }
  async ListPenaltyRulesByTeamID(teamID: string): Promise<P.PenaltyRule[]> {
    return this.db
      .select(penaltyFields)
      .from(penaltyRules)
      .where(and(eq(penaltyRules.team_id, teamID), this.teamAccess(penaltyRules.team_id)))
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
          this.teamAccess(penaltyRules.team_id),
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
      .where(
        and(
          eq(penaltyRules.team_id, teamID),
          isNull(penaltyRules.deleted_at),
          this.teamAccess(penaltyRules.team_id),
        ),
      )
      .orderBy(penaltyRules.threshold);
  }
  async SoftDeletePenaltyRule(arg: P.SoftDeletePenaltyRuleParams): Promise<number> {
    return this.db
      .update(penaltyRules)
      .set({
        deleted_at: arg.DeletedAt,
        updated_at: arg.DeletedAt,
      })
      .where(
        and(
          eq(penaltyRules.id, arg.ID),
          isNull(penaltyRules.deleted_at),
          this.teamAccess(penaltyRules.team_id),
        ),
      )
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
      .where(and(eq(penaltyRules.id, arg.ID), this.teamAccess(penaltyRules.team_id)))
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
      .where(and(eq(user.id, id), this.identityAccess(user.id), this.access()));
    return required(rows, "GetUserByID");
  }
  async UpdateUserColorHex(arg: P.UpdateUserColorHexParams): Promise<void> {
    await this.db
      .update(user)
      .set({
        colorHex: arg.ColorHex || null,
        updatedAt: new Date(),
      })
      .where(and(eq(user.id, arg.ID), this.identityAccess(user.id), this.access()))
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
      .where(and(eq(user.id, arg.ID), this.identityAccess(user.id), this.access()))
      .returning()
      .then((rows) => rows.length);
  }
  async ProvisionUser(userId: string, teamId: string, name: string, now: string): Promise<void> {
    this.requireSystemAccess();
    await this.db.batch([
      this.db.insert(teams).select(sql`SELECT ${teamId},${name},${now},'[null]'
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
          WHERE code = ${arg.inviteCode} AND team_id = ${arg.toTeamId}
            AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        )`
      : sql`1`;
    const valid = sql`${currentMembership} AND ${validInvite}
      AND ${this.teamAccess(arg.fromTeamId)} AND ${this.identityAccess(arg.userId)}`;
    // 所属の移動、担当解除、owner引継ぎ、空チーム削除を一度にcommitする。
    const [, , , , membershipUpdate] = await this.db.batch([
      this.db
        .insert(teams)
        .select(
          sql`SELECT ${arg.toTeamId},${arg.newTeamName ?? ""},${arg.now},'[null]' WHERE ${!arg.inviteCode} AND ${valid}`,
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
      // Select the successor while the original membership still authorizes the batch.
      this.db.update(teamMembers).set({ role: "owner" }).where(sql`
        team_id=${arg.fromTeamId} AND ${valid}
        AND user_id=(SELECT user_id FROM team_members WHERE team_id=${arg.fromTeamId}
          AND user_id<>${arg.userId} ORDER BY created_at,user_id LIMIT 1)
        AND NOT EXISTS(SELECT 1 FROM team_members WHERE team_id=${arg.fromTeamId}
          AND user_id<>${arg.userId} AND role='owner')`),
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
      // SQLite changes() refers to the immediately preceding membership UPDATE in this
      // atomic batch. A rejected move must not delete an unrelated empty team.
      this.db
        .delete(teams)
        .where(
          and(
            eq(teams.id, arg.fromTeamId),
            sql`changes()>0`,
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
    const allowed = and(owner, this.teamAccess(arg.TeamID), this.identityAccess(userId))!;
    const [, result] = await this.db.batch([
      this.db.delete(inviteCodes).where(and(eq(inviteCodes.team_id, arg.TeamID), allowed)),
      this.db
        .insert(inviteCodes)
        .select(
          sql`SELECT ${arg.Code},${arg.TeamID},${arg.ExpiresAt},strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ${allowed}`,
        ),
    ]);
    if (!result.meta.changes) throw new AppError(403, "forbidden", "owner role required");
  }
  async Reorder(arg: P.ReorderParams): Promise<void> {
    if (!arg.ids.length) return;
    const table = arg.kind === "tasks" ? tasks : todoItems;
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
      .where(and(scope, this.teamAccess(table.team_id), valid))
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
      ) AND ${this.teamAccess(arg.teamId)} AND ${this.identityAccess(arg.userId)} AND ${singleCompletionRequired}
    `;
    const change = this.completionChange(arg, allowed);
    const summaries = arg.recalculateMonth
      ? summaryStatements(this.db, {
          teamId: arg.teamId,
          month: arg.recalculateMonth,
          ensureCoverage: arg.ensureCoverage,
          access: allowed,
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
      .where(and(eq(table.task_id, arg.taskId), eq(target, arg.target), allowed));

    // 完了変更・過去集計・結果の件数取得を同じbatchで確定する。
    const results = await this.db.batch([change, ...summaries, countCompletions]);
    // 集計SQLの数が可変でも、最後は必ずcountCompletionsの結果。
    const rows = results.at(-1) as Awaited<typeof countCompletions>;
    return rows[0].count;
  }
  async RecalculateMonth(arg: P.RecalculateMonthParams): Promise<void> {
    const statements = summaryStatements(this.db, { ...arg, access: this.teamAccess(arg.teamId) });
    await this.db.batch(statements);
  }
  async ClosePeriod(teamId: string, scope: "day" | "week", date: string): Promise<boolean> {
    this.requireSystemAccess();
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
