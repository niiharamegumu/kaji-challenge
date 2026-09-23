// Persistence ports. SQL is isolated in infrastructure/repository.ts.

export interface CreateTaskCompletionDailyParams {
  TaskID: string;
  TargetDate: string;
  CompletedByUserID: string;
}

export interface DeleteLatestTaskCompletionWeeklyEntryParams {
  TaskID: string;
  WeekStart: string;
}

export interface DeleteTaskCompletionDailyParams {
  TaskID: string;
  TargetDate: string;
}

export interface GetTaskCompletionWeeklyEntryCountParams {
  TaskID: string;
  WeekStart: string;
}

export interface HasTaskCompletionDailyParams {
  TaskID: string;
  TargetDate: string;
}

export interface InsertTaskCompletionWeeklyEntryParams {
  ID: string;
  TaskID: string;
  WeekStart: string;
  CompletedByUserID: string;
}

export interface ListTaskCompletionDailyByMonthAndTeamParams {
  TeamID: string;
  TargetDate: string;
  TargetDate_2: string;
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
  WeekStart_2: string;
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

export interface AddTeamMemberParams {
  TeamID: string;
  UserID: string;
  Role: string;
  CreatedAt: string;
}

export interface CreateTeamParams {
  ID: string;
  Name: string;
  CreatedAt: string;
}

export interface DeleteTeamMemberParams {
  TeamID: string;
  UserID: string;
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

export interface UpdateTeamMemberRoleParams {
  TeamID: string;
  UserID: string;
  Role: string;
}

export interface UpdateTeamNameParams {
  ID: string;
  Name: string;
}

export interface UpdateTeamStateRevisionIfMatchParams {
  ID: string;
  StateRevision: string;
}

export interface SumDailyPenaltyForCloseParams {
  TeamID: string;
  TargetDate: string;
  CreatedAt: string;
}

export interface SumDailyPenaltyForMonthParams {
  TeamID: string;
  TargetDate: string;
  TargetDate_2: string;
}

export interface SumWeeklyPenaltyForCloseParams {
  TeamID: string;
  WeekStart: string;
  CreatedAt: string;
}

export interface SumWeeklyPenaltyForMonthParams {
  TeamID: string;
  TargetDate: string;
  TargetDate_2: string;
}

export interface CreateInviteCodeParams {
  Code: string;
  TeamID: string;
  ExpiresAt: string;
}

export interface ClearTaskAssigneeByTeamAndUserParams {
  TeamID: string;
  Column2: string;
}

export interface CreateTaskParams {
  ID: string;
  TeamID: string;
  Title: string;
  Notes: string | null;
  Type: string;
  PenaltyPoints: number;
  Column7: string;
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
  Title: string;
  Notes: string | null;
  PenaltyPoints: number;
  Column5: string;
  RequiredCompletionsPerWeek: number;
  UpdatedAt: string;
}

export interface UpdateTaskSortKeyParams {
  ID: string;
  SortKey: number;
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
  Column7: string;
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
  Name: string;
  Notes: string | null;
  UpdatedAt: string;
}

export interface UpdateShoppingItemSortKeyParams {
  ID: string;
  SortKey: number;
  UpdatedAt: string;
}

export interface AddTriggeredRuleForMonthParams {
  TeamID: string;
  MonthStart: string;
  RuleID: string;
}

export interface CloseMonthlyPenaltySummaryParams {
  TeamID: string;
  MonthStart: string;
}

export interface DeleteTriggeredRulesByMonthParams {
  TeamID: string;
  MonthStart: string;
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

export interface IncrementDailyPenaltyParams {
  TeamID: string;
  MonthStart: string;
  DailyPenaltyTotal: number;
}

export interface IncrementWeeklyPenaltyParams {
  TeamID: string;
  MonthStart: string;
  WeeklyPenaltyTotal: number;
}

export interface ListTriggeredRuleIDsByMonthParams {
  TeamID: string;
  MonthStart: string;
}

export interface SetMonthPenaltyTotalsParams {
  TeamID: string;
  MonthStart: string;
  DailyPenaltyTotal: number;
  WeeklyPenaltyTotal: number;
}

export interface UpsertMonthlyPenaltySummaryParams {
  TeamID: string;
  MonthStart: string;
  DailyPenaltyTotal: number;
  WeeklyPenaltyTotal: number;
  IsClosed: boolean;
}

export interface GetLatestCloseRunTargetDateParams {
  TeamID: string;
  Scope: string;
}

export interface InsertCloseRunParams {
  TeamID: string;
  Scope: string;
  TargetDate: string;
}

export interface InsertDayCloseRunsForMonthParams {
  TeamID: string;
  MonthStart: string;
  MonthEnd: string;
}

export interface InsertWeekCloseRunsForMonthParams {
  TeamID: string;
  FirstWeekStart: string;
  MonthEnd: string;
  MonthStart: string;
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
  Title: string;
  Notes: string | null;
  Kind: string;
  ScheduleType: string | null;
  StartDate: string;
  EndDate: string | null;
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
  Threshold: number;
  Name: string;
  Description: string | null;
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
  Column2: string;
}

export interface UpdateUserNicknameParams {
  ID: string;
  Column2: string;
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
  StateRevision: string;
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

export interface Repository {
  CreateTaskCompletionDaily(arg: CreateTaskCompletionDailyParams): Promise<void>;
  DeleteLatestTaskCompletionWeeklyEntry(
    arg: DeleteLatestTaskCompletionWeeklyEntryParams,
  ): Promise<number>;
  DeleteTaskCompletionDaily(arg: DeleteTaskCompletionDailyParams): Promise<void>;
  GetTaskCompletionWeeklyEntryCount(arg: GetTaskCompletionWeeklyEntryCountParams): Promise<number>;
  HasTaskCompletionDaily(arg: HasTaskCompletionDailyParams): Promise<boolean>;
  InsertTaskCompletionWeeklyEntry(arg: InsertTaskCompletionWeeklyEntryParams): Promise<void>;
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
  AddTeamMember(arg: AddTeamMemberParams): Promise<void>;
  CreateTeam(arg: CreateTeamParams): Promise<void>;
  DeleteTeam(id: string): Promise<void>;
  DeleteTeamMember(arg: DeleteTeamMemberParams): Promise<void>;
  GetTeamStateRevision(id: string): Promise<string>;
  ListMembershipsByUserID(userID: string): Promise<ListMembershipsByUserIDRow[]>;
  ListTeamIDsForClose(): Promise<string[]>;
  ListTeamMembersByTeamID(teamID: string): Promise<ListTeamMembersByTeamIDRow[]>;
  UpdateTeamMemberRole(arg: UpdateTeamMemberRoleParams): Promise<void>;
  UpdateTeamName(arg: UpdateTeamNameParams): Promise<void>;
  UpdateTeamStateRevisionIfMatch(arg: UpdateTeamStateRevisionIfMatchParams): Promise<string>;
  SumDailyPenaltyForClose(arg: SumDailyPenaltyForCloseParams): Promise<number>;
  SumDailyPenaltyForMonth(arg: SumDailyPenaltyForMonthParams): Promise<number>;
  SumWeeklyPenaltyForClose(arg: SumWeeklyPenaltyForCloseParams): Promise<number>;
  SumWeeklyPenaltyForMonth(arg: SumWeeklyPenaltyForMonthParams): Promise<number>;
  CreateInviteCode(arg: CreateInviteCodeParams): Promise<void>;
  DeleteInviteCodesByTeamID(teamID: string): Promise<void>;
  GetInviteCode(code: string): Promise<InviteCode>;
  GetLatestInviteCodeByTeamID(teamID: string): Promise<InviteCode>;
  ClearTaskAssigneeByTeamAndUser(arg: ClearTaskAssigneeByTeamAndUserParams): Promise<void>;
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
  UpdateTaskSortKey(arg: UpdateTaskSortKeyParams): Promise<void>;
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
  UpdateShoppingItemSortKey(arg: UpdateShoppingItemSortKeyParams): Promise<void>;
  AddTriggeredRuleForMonth(arg: AddTriggeredRuleForMonthParams): Promise<void>;
  CloseMonthlyPenaltySummary(arg: CloseMonthlyPenaltySummaryParams): Promise<void>;
  DeleteTriggeredRulesByMonth(arg: DeleteTriggeredRulesByMonthParams): Promise<void>;
  FindOldestMonthCloseCandidate(
    arg: FindOldestMonthCloseCandidateParams,
  ): Promise<FindOldestMonthCloseCandidateRow>;
  GetMonthlyPenaltySummary(arg: GetMonthlyPenaltySummaryParams): Promise<MonthlyPenaltySummary>;
  IncrementDailyPenalty(arg: IncrementDailyPenaltyParams): Promise<void>;
  IncrementWeeklyPenalty(arg: IncrementWeeklyPenaltyParams): Promise<void>;
  ListTriggeredRuleIDsByMonth(arg: ListTriggeredRuleIDsByMonthParams): Promise<string[]>;
  SetMonthPenaltyTotals(arg: SetMonthPenaltyTotalsParams): Promise<void>;
  UpsertMonthlyPenaltySummary(arg: UpsertMonthlyPenaltySummaryParams): Promise<void>;
  GetLatestCloseRunTargetDate(arg: GetLatestCloseRunTargetDateParams): Promise<string>;
  InsertCloseRun(arg: InsertCloseRunParams): Promise<number>;
  InsertDayCloseRunsForMonth(arg: InsertDayCloseRunsForMonthParams): Promise<void>;
  InsertWeekCloseRunsForMonth(arg: InsertWeekCloseRunsForMonthParams): Promise<void>;
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
  transaction<T>(fn: (repo: Repository) => Promise<T>): Promise<T>;
}
