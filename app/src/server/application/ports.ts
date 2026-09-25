export interface GetTaskCompletionWeeklyEntryCountParams {
  TaskID: string;
  WeekStart: string;
}

export interface HasTaskCompletionDailyParams {
  TaskID: string;
  TargetDate: string;
}

export interface ListTaskCompletionDailyByMonthAndTeamParams {
  TeamID: string;
  TargetDate: string;
  BeforeDate: string;
}

export interface ListTaskCompletionDailyByMonthAndTeamRow {
  TaskID: string;
  TargetDate: string;
  CompletedByUserID: string;
  CompletedByEffectiveName: string;
  CompletedByColorHex: string | null;
}

export interface ListTaskCompletionDailyByTeamAndDateParams {
  TeamID: string;
  TargetDate: string;
}

export interface ListTaskCompletionDailyByTeamAndDateRow {
  TaskID: string;
  CompletedByUserID: string;
  CompletedByEffectiveName: string;
  CompletedByColorHex: string | null;
}

export interface ListTaskCompletionWeeklyCountsByTeamAndWeekParams {
  TeamID: string;
  WeekStart: string;
}

export interface ListTaskCompletionWeeklyCountsByTeamAndWeekRow {
  TaskID: string;
  CompletionCount: number;
}

export interface ListTaskCompletionWeeklySlotsByMonthAndTeamParams {
  TeamID: string;
  WeekStart: string;
  BeforeWeekStart: string;
}

export interface ListTaskCompletionWeeklySlotsByMonthAndTeamRow {
  TaskID: string;
  WeekStart: string;
  Slot: number;
  CompletedByUserID: string;
  CompletedByEffectiveName: string;
  CompletedByColorHex: string | null;
}

export interface ListTaskCompletionWeeklySlotsByTeamAndWeekParams {
  TeamID: string;
  WeekStart: string;
}

export interface ListTaskCompletionWeeklySlotsByTeamAndWeekRow {
  TaskID: string;
  Slot: number;
  CompletedByUserID: string;
  CompletedByEffectiveName: string;
  CompletedByColorHex: string | null;
}

export interface ListMembershipsByUserIDRow {
  TeamID: string;
  Role: string;
  TeamName: string;
}

export interface ListTeamMembersByTeamIDRow {
  TeamID: string;
  UserID: string;
  Role: string;
  CreatedAt: string;
  DisplayName: string;
  Nickname: string;
  ColorHex: string | null;
}

export interface UpdateTeamNameParams {
  ID: string;
  Name: string;
}

export interface CreateInviteCodeParams {
  Code: string;
  TeamID: string;
  ExpiresAt: string;
}

export interface CreateTaskParams {
  ID: string;
  TeamID: string;
  Title: string;
  Notes: string | null;
  Type: string;
  PenaltyPoints: number;
  AssigneeUserID: string;
  RequiredCompletionsPerWeek: number;
  SortKey: number;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface GetTaskByIDRow {
  ID: string;
  TeamID: string;
  Title: string;
  Notes: string | null;
  Type: string;
  PenaltyPoints: number;
  AssigneeUserID: string;
  RequiredCompletionsPerWeek: number;
  SortKey: number;
  CreatedAt: string;
  UpdatedAt: string;
  DeletedAt: string | null;
}

export interface ListTasksByTeamIDRow {
  ID: string;
  TeamID: string;
  Title: string;
  Notes: string | null;
  Type: string;
  PenaltyPoints: number;
  AssigneeUserID: string;
  RequiredCompletionsPerWeek: number;
  SortKey: number;
  CreatedAt: string;
  UpdatedAt: string;
  DeletedAt: string | null;
}

export interface ListTasksEffectiveForCloseByTeamAndTypeParams {
  TeamID: string;
  Type: string;
  CreatedAt: string;
}

export interface ListTasksEffectiveForCloseByTeamAndTypeRow {
  ID: string;
  TeamID: string;
  Title: string;
  Notes: string | null;
  Type: string;
  PenaltyPoints: number;
  AssigneeUserID: string;
  RequiredCompletionsPerWeek: number;
  SortKey: number;
  CreatedAt: string;
  UpdatedAt: string;
  DeletedAt: string | null;
}

export interface ListTasksForMonthlyStatusByTeamParams {
  TeamID: string;
  DeletedAt: string | null;
  CreatedAt: string;
}

export interface ListTasksForMonthlyStatusByTeamRow {
  ID: string;
  Title: string;
  Notes: string | null;
  Type: string;
  PenaltyPoints: number;
  RequiredCompletionsPerWeek: number;
  SortKey: number;
  CreatedAt: string;
  DeletedAt: string | null;
}

export interface UpdateTaskParams {
  ID: string;
  Title?: string;
  Notes?: string | null;
  PenaltyPoints?: number;
  AssigneeUserID?: string;
  RequiredCompletionsPerWeek?: number;
  UpdatedAt: string;
}

export interface DeactivatePushSubscriptionByEndpointParams {
  Endpoint: string;
  UpdatedAt: string;
}

export interface DeactivatePushSubscriptionByIDAndUserParams {
  ID: string;
  UserID: string;
  UpdatedAt: string;
}

export interface ListActivePushSubscriptionsByTeamIDRow {
  ID: string;
  TeamID: string;
  UserID: string;
  Endpoint: string;
  P256dh: string;
  Auth: string;
  UserAgent: string;
  Platform: string;
  IsActive: boolean;
  LastSeenAt: string;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface ListPushSubscriptionsByUserIDRow {
  ID: string;
  TeamID: string;
  UserID: string;
  Endpoint: string;
  P256dh: string;
  Auth: string;
  UserAgent: string;
  Platform: string;
  IsActive: boolean;
  LastSeenAt: string;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface UpsertPushSubscriptionParams {
  ID: string;
  TeamID: string;
  UserID: string;
  Endpoint: string;
  P256dh: string;
  Auth: string;
  UserAgent: string;
  Platform: string;
  LastSeenAt: string;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface UpsertPushSubscriptionRow {
  ID: string;
  TeamID: string;
  UserID: string;
  Endpoint: string;
  P256dh: string;
  Auth: string;
  UserAgent: string;
  Platform: string;
  IsActive: boolean;
  LastSeenAt: string;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface CreateShoppingItemParams {
  ID: string;
  TeamID: string;
  Name: string;
  Notes: string | null;
  SortKey: number;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface UpdateShoppingItemParams {
  ID: string;
  Name?: string;
  Notes?: string | null;
  UpdatedAt: string;
}

export interface FindOldestMonthCloseCandidateParams {
  TeamID: string;
  CurrentMonthStart: string;
}

export interface FindOldestMonthCloseCandidateRow {
  MonthStart: string;
  PendingMonthCount: number;
}

export interface GetMonthlyPenaltySummaryParams {
  TeamID: string;
  MonthStart: string;
}

export interface ListTriggeredRuleIDsByMonthParams {
  TeamID: string;
  MonthStart: string;
}

export interface GetLatestCloseRunTargetDateParams {
  TeamID: string;
  Scope: string;
}

export interface CreateReminderParams {
  ID: string;
  TeamID: string;
  Title: string;
  Notes: string | null;
  Kind: string;
  ScheduleType: string | null;
  StartDate: string;
  EndDate: string | null;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface DeleteExpiredOneTimeRemindersByTeamParams {
  TeamID: string;
  StartDate: string;
}

export interface UpdateReminderParams {
  ID: string;
  Title?: string;
  Notes?: string | null;
  Kind?: string;
  ScheduleType?: string | null;
  StartDate?: string;
  EndDate?: string | null;
  UpdatedAt: string;
}

export interface CreatePenaltyRuleParams {
  ID: string;
  TeamID: string;
  Threshold: number;
  Name: string;
  Description: string | null;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface ListPenaltyRulesEffectiveAtByTeamIDParams {
  TeamID: string;
  AsOf: string;
}

export interface SoftDeletePenaltyRuleParams {
  ID: string;
  DeletedAt: string;
}

export interface UpdatePenaltyRuleParams {
  ID: string;
  Threshold?: number;
  Name?: string;
  Description?: string | null;
  UpdatedAt: string;
}

export interface GetUserByIDRow {
  ID: string;
  Email: string;
  DisplayName: string;
  Nickname: string;
  ColorHex: string | null;
  CreatedAt: string;
}

export interface UpdateUserColorHexParams {
  ID: string;
  ColorHex: string;
}

export interface UpdateUserNicknameParams {
  ID: string;
  Nickname: string;
}

export interface InviteCode {
  Code: string;
  TeamID: string;
  ExpiresAt: string;
  CreatedAt: string;
}

export interface MonthlyPenaltySummary {
  TeamID: string;
  MonthStart: string;
  DailyPenaltyTotal: number;
  WeeklyPenaltyTotal: number;
  IsClosed: boolean;
}

export interface PenaltyRule {
  ID: string;
  TeamID: string;
  Threshold: number;
  Name: string;
  Description: string | null;
  DeletedAt: string | null;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface PushSubscription {
  ID: string;
  TeamID: string;
  UserID: string;
  Endpoint: string;
  P256dh: string;
  Auth: string;
  UserAgent: string | null;
  Platform: string;
  IsActive: boolean;
  LastSeenAt: string;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface Reminder {
  ID: string;
  TeamID: string;
  Title: string;
  Notes: string | null;
  Kind: string;
  ScheduleType: string | null;
  StartDate: string;
  EndDate: string | null;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface ShoppingItem {
  ID: string;
  TeamID: string;
  Name: string;
  Notes: string | null;
  SortKey: number;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface Task {
  ID: string;
  TeamID: string;
  Title: string;
  Notes: string | null;
  Type: string;
  PenaltyPoints: number;
  AssigneeUserID: string;
  RequiredCompletionsPerWeek: number;
  CreatedAt: string;
  UpdatedAt: string;
  DeletedAt: string | null;
  SortKey: number;
}

export interface Team {
  ID: string;
  CreatedAt: string;
  Name: string;
}

export interface TeamMember {
  TeamID: string;
  UserID: string;
  Role: string;
  CreatedAt: string;
}

export interface User {
  ID: string;
  Email: string;
  DisplayName: string;
  CreatedAt: string;
  Nickname: string | null;
  ColorHex: string | null;
}

export interface MoveMemberParams {
  userId: string;
  fromTeamId: string;
  toTeamId: string;
  now: string;
  inviteCode?: string;
  newTeamName?: string;
}

export type ReorderParams = {
  teamId: string;
  ids: string[];
  now: string;
} & ({ kind: "tasks"; type: string } | { kind: "shopping" });

export interface SetCompletionParams {
  teamId: string;
  userId: string;
  taskId: string;
  type: "daily" | "weekly";
  target: string;
  action: "complete" | "incomplete" | "increment" | "decrement";
  cutoff: string;
  now: string;
  recalculateMonth?: string;
  ensureCoverage: boolean;
}

export interface RecalculateMonthParams {
  teamId: string;
  month: string;
  ensureCoverage: boolean;
  closeMonth?: boolean;
}

export interface Repository {
  forMember(teamId: string, userId: string): Repository;
  ProvisionUser(userId: string, teamId: string, name: string, now: string): Promise<void>;
  MoveMember(arg: MoveMemberParams): Promise<void>;
  ReplaceInvite(arg: CreateInviteCodeParams, userId: string): Promise<void>;
  Reorder(arg: ReorderParams): Promise<void>;
  SetCompletion(arg: SetCompletionParams): Promise<number>;
  ClosePeriod(teamId: string, scope: "day" | "week", date: string): Promise<boolean>;
  RecalculateMonth(arg: RecalculateMonthParams): Promise<void>;
  GetTaskCompletionWeeklyEntryCount(arg: GetTaskCompletionWeeklyEntryCountParams): Promise<number>;
  HasTaskCompletionDaily(arg: HasTaskCompletionDailyParams): Promise<boolean>;
  ListTaskCompletionDailyByMonthAndTeam(
    arg: ListTaskCompletionDailyByMonthAndTeamParams,
  ): Promise<ListTaskCompletionDailyByMonthAndTeamRow[]>;
  ListTaskCompletionDailyByTeamAndDate(
    arg: ListTaskCompletionDailyByTeamAndDateParams,
  ): Promise<ListTaskCompletionDailyByTeamAndDateRow[]>;
  ListTaskCompletionWeeklyCountsByTeamAndWeek(
    arg: ListTaskCompletionWeeklyCountsByTeamAndWeekParams,
  ): Promise<ListTaskCompletionWeeklyCountsByTeamAndWeekRow[]>;
  ListTaskCompletionWeeklySlotsByMonthAndTeam(
    arg: ListTaskCompletionWeeklySlotsByMonthAndTeamParams,
  ): Promise<ListTaskCompletionWeeklySlotsByMonthAndTeamRow[]>;
  ListTaskCompletionWeeklySlotsByTeamAndWeek(
    arg: ListTaskCompletionWeeklySlotsByTeamAndWeekParams,
  ): Promise<ListTaskCompletionWeeklySlotsByTeamAndWeekRow[]>;
  DeleteTeam(id: string): Promise<void>;
  ListMembershipsByUserID(userID: string): Promise<ListMembershipsByUserIDRow[]>;
  ListTeamIDsForClose(): Promise<string[]>;
  ListTeamMembersByTeamID(teamID: string): Promise<ListTeamMembersByTeamIDRow[]>;
  UpdateTeamName(arg: UpdateTeamNameParams): Promise<void>;
  GetInviteCode(code: string): Promise<InviteCode>;
  GetLatestInviteCodeByTeamID(teamID: string): Promise<InviteCode>;
  CreateTask(arg: CreateTaskParams): Promise<void>;
  DeleteTask(id: string): Promise<void>;
  GetEarliestTaskCreatedAtByTeam(teamID: string): Promise<string>;
  GetTaskByID(id: string): Promise<GetTaskByIDRow>;
  ListTasksByTeamID(teamID: string): Promise<ListTasksByTeamIDRow[]>;
  ListTasksEffectiveForCloseByTeamAndType(
    arg: ListTasksEffectiveForCloseByTeamAndTypeParams,
  ): Promise<ListTasksEffectiveForCloseByTeamAndTypeRow[]>;
  ListTasksForMonthlyStatusByTeam(
    arg: ListTasksForMonthlyStatusByTeamParams,
  ): Promise<ListTasksForMonthlyStatusByTeamRow[]>;
  UpdateTask(arg: UpdateTaskParams): Promise<void>;
  DeactivatePushSubscriptionByEndpoint(
    arg: DeactivatePushSubscriptionByEndpointParams,
  ): Promise<number>;
  DeactivatePushSubscriptionByIDAndUser(
    arg: DeactivatePushSubscriptionByIDAndUserParams,
  ): Promise<number>;
  ListActivePushSubscriptionsByTeamID(
    teamID: string,
  ): Promise<ListActivePushSubscriptionsByTeamIDRow[]>;
  ListPushSubscriptionsByUserID(userID: string): Promise<ListPushSubscriptionsByUserIDRow[]>;
  ListTeamIDsForPush(): Promise<string[]>;
  UpsertPushSubscription(arg: UpsertPushSubscriptionParams): Promise<UpsertPushSubscriptionRow>;
  CreateShoppingItem(arg: CreateShoppingItemParams): Promise<void>;
  DeleteShoppingItem(id: string): Promise<number>;
  GetShoppingItemByID(id: string): Promise<ShoppingItem>;
  ListShoppingItemsByTeamID(teamID: string): Promise<ShoppingItem[]>;
  UpdateShoppingItem(arg: UpdateShoppingItemParams): Promise<void>;
  FindOldestMonthCloseCandidate(
    arg: FindOldestMonthCloseCandidateParams,
  ): Promise<FindOldestMonthCloseCandidateRow>;
  GetMonthlyPenaltySummary(arg: GetMonthlyPenaltySummaryParams): Promise<MonthlyPenaltySummary>;
  ListTriggeredRuleIDsByMonth(arg: ListTriggeredRuleIDsByMonthParams): Promise<string[]>;
  GetLatestCloseRunTargetDate(arg: GetLatestCloseRunTargetDateParams): Promise<string>;
  CreateReminder(arg: CreateReminderParams): Promise<void>;
  DeleteExpiredOneTimeRemindersByTeam(
    arg: DeleteExpiredOneTimeRemindersByTeamParams,
  ): Promise<number>;
  DeleteReminder(id: string): Promise<number>;
  GetReminderByID(id: string): Promise<Reminder>;
  ListRemindersByTeamID(teamID: string): Promise<Reminder[]>;
  UpdateReminder(arg: UpdateReminderParams): Promise<void>;
  CreatePenaltyRule(arg: CreatePenaltyRuleParams): Promise<void>;
  GetUndeletedPenaltyRuleByID(id: string): Promise<PenaltyRule>;
  ListPenaltyRulesByTeamID(teamID: string): Promise<PenaltyRule[]>;
  ListPenaltyRulesEffectiveAtByTeamID(
    arg: ListPenaltyRulesEffectiveAtByTeamIDParams,
  ): Promise<PenaltyRule[]>;
  ListUndeletedPenaltyRulesByTeamID(teamID: string): Promise<PenaltyRule[]>;
  SoftDeletePenaltyRule(arg: SoftDeletePenaltyRuleParams): Promise<number>;
  UpdatePenaltyRule(arg: UpdatePenaltyRuleParams): Promise<void>;
  GetUserByID(id: string): Promise<GetUserByIDRow>;
  UpdateUserColorHex(arg: UpdateUserColorHexParams): Promise<void>;
  UpdateUserNickname(arg: UpdateUserNicknameParams): Promise<void>;
}
