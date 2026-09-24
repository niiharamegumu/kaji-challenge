import { z } from "zod";
import { isDate } from "../server/domain/dates";
export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  colorHex: z.string().nullable().optional(),
  createdAt: z.iso.datetime({ offset: true }),
});
export const TeamMembershipSchema = z.object({
  teamId: z.string(),
  role: z.enum(["owner", "member"]),
  teamName: z.string(),
});
export const MeResponseSchema = z.object({
  user: UserSchema,
  memberships: z.array(TeamMembershipSchema),
});
export const CreateInviteRequestSchema = z.object({
  expiresInHours: z.number().int().min(1).max(720).optional(),
});
export const InviteCodeResponseSchema = z.object({
  code: z.string(),
  teamId: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export const JoinTeamRequestSchema = z.object({ code: z.string().min(6).max(64) });
export const JoinTeamResponseSchema = z.object({ teamId: z.string() });
export const UpdateCurrentTeamRequestSchema = z.object({ name: z.string().min(1).max(50) });
export const TeamInfoResponseSchema = z.object({ teamId: z.string(), name: z.string() });
export const TeamMemberSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  nickname: z.string().nullable().optional(),
  effectiveName: z.string(),
  colorHex: z.string().nullable().optional(),
  joinedAt: z.iso.datetime({ offset: true }),
  role: z.enum(["owner", "member"]),
});
export const TeamMembersResponseSchema = z.object({ items: z.array(TeamMemberSchema) });
export const UpdateNicknameRequestSchema = z.object({ nickname: z.string().max(30) });
export const UpdateNicknameResponseSchema = z.object({
  nickname: z.string(),
  effectiveName: z.string(),
});
export const UpdateColorRequestSchema = z.object({ colorHex: z.string().nullable() });
export const UpdateColorResponseSchema = z.object({ colorHex: z.string().nullable() });
export const PushPlatformSchema = z.enum(["ios_safari_pwa"]);
export const PushSubscriptionSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  userId: z.string(),
  endpoint: z.string(),
  userAgent: z.string().nullable().optional(),
  platform: PushPlatformSchema,
  isActive: z.boolean(),
  lastSeenAt: z.iso.datetime({ offset: true }),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export const PushSubscriptionKeysSchema = z.object({
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});
export const UpsertPushSubscriptionRequestSchema = z.object({
  endpoint: z.string(),
  keys: PushSubscriptionKeysSchema,
  userAgent: z.string().optional(),
  platform: PushPlatformSchema,
});
export const ListPushSubscriptionsResponseSchema = z.object({
  items: z.array(PushSubscriptionSchema),
  vapidPublicKey: z.string(),
});
export const TaskTypeSchema = z.enum(["daily", "weekly"]);
export const ReminderKindSchema = z.enum(["one_time", "recurring"]);
export const ReminderScheduleTypeSchema = z.enum(["daily", "weekly", "monthly"]);
export const ReminderSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  title: z.string(),
  notes: z.string().nullable().optional(),
  kind: ReminderKindSchema,
  scheduleType: ReminderScheduleTypeSchema.nullable().optional(),
  startDate: z.string().refine(isDate, "invalid date"),
  endDate: z.string().refine(isDate, "invalid date").nullable().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export const CreateReminderRequestSchema = z.object({
  title: z.string().min(1).max(100),
  notes: z.string().max(500).optional(),
  kind: ReminderKindSchema,
  scheduleType: ReminderScheduleTypeSchema.optional(),
  startDate: z.string().refine(isDate, "invalid date"),
  endDate: z.string().refine(isDate, "invalid date").optional(),
});
export const UpdateReminderRequestSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  notes: z.string().max(500).nullable().optional(),
  kind: ReminderKindSchema.optional(),
  scheduleType: ReminderScheduleTypeSchema.nullable().optional(),
  startDate: z.string().refine(isDate, "invalid date").optional(),
  endDate: z.string().refine(isDate, "invalid date").nullable().optional(),
});
export const ReminderOccurrenceSchema = z.object({
  reminderId: z.string(),
  date: z.string().refine(isDate, "invalid date"),
  title: z.string(),
  notes: z.string().nullable().optional(),
  kind: ReminderKindSchema,
  scheduleType: ReminderScheduleTypeSchema.nullable().optional(),
});
export const ReminderCalendarDaySchema = z.object({
  date: z.string().refine(isDate, "invalid date"),
  items: z.array(ReminderOccurrenceSchema),
});
export const ReminderCalendarResponseSchema = z.object({
  days: z.array(ReminderCalendarDaySchema),
});
export const ReminderListResponseSchema = z.object({ items: z.array(ReminderSchema) });
export const TaskSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  title: z.string(),
  notes: z.string().optional(),
  type: TaskTypeSchema,
  penaltyPoints: z.number().int().min(0).max(1000),
  assigneeUserId: z.string().optional(),
  requiredCompletionsPerWeek: z.number().int().min(1).max(7),
  sortKey: z.number().int().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1).max(100),
  notes: z.string().max(500).optional(),
  type: TaskTypeSchema,
  penaltyPoints: z.number().int().min(0).max(1000),
  assigneeUserId: z.string().optional(),
  requiredCompletionsPerWeek: z.number().int().min(1).max(7).optional(),
});
export const UpdateTaskRequestSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  notes: z.string().max(500).optional(),
  penaltyPoints: z.number().int().min(0).max(1000).optional(),
  assigneeUserId: z.string().optional(),
  requiredCompletionsPerWeek: z.number().int().min(1).max(7).optional(),
});
export const ReorderTasksRequestSchema = z.object({ taskIds: z.array(z.string()).min(1) });
export const ToggleTaskCompletionRequestSchema = z.object({
  targetDate: z.string().refine(isDate, "invalid date"),
  action: z.enum(["toggle", "increment", "decrement", "complete"]).optional(),
});
export const TaskCompletionResponseSchema = z.object({
  taskId: z.string(),
  targetDate: z.string().refine(isDate, "invalid date"),
  completed: z.boolean(),
  weeklyCompletedCount: z.number().int(),
});
export const TaskCompletionActorSchema = z.object({
  userId: z.string(),
  effectiveName: z.string(),
  colorHex: z.string().nullable().optional(),
});
export const TaskCompletionSlotSchema = z.object({
  slot: z.number().int(),
  actor: TaskCompletionActorSchema.nullable().optional(),
});
export const PenaltyRuleSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  threshold: z.number().int().min(1),
  name: z.string(),
  description: z.string().optional(),
  deletedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export const CreatePenaltyRuleRequestSchema = z.object({
  threshold: z.number().int().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});
export const UpdatePenaltyRuleRequestSchema = z.object({
  threshold: z.number().int().min(1).optional(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});
export const ShoppingListItemSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  notes: z.string().nullable().optional(),
  sortKey: z.number().int().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export const CreateShoppingListItemRequestSchema = z.object({
  name: z.string().min(1).max(100),
  notes: z.string().max(500).optional(),
});
export const UpdateShoppingListItemRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  notes: z.string().max(500).nullable().optional(),
});
export const ReorderShoppingListItemsRequestSchema = z.object({
  itemIds: z.array(z.string()).min(1),
});
export const TaskOverviewDailyTaskSchema = z.object({
  task: TaskSchema,
  completedToday: z.boolean(),
  completedBy: TaskCompletionActorSchema.nullable().optional(),
});
export const TaskOverviewWeeklyTaskSchema = z.object({
  task: TaskSchema,
  weekCompletedCount: z.number().int(),
  requiredCompletionsPerWeek: z.number().int().min(1).max(7),
  completionSlots: z.array(TaskCompletionSlotSchema),
});
export const TaskOverviewResponseSchema = z.object({
  month: z.string(),
  today: z.string().refine(isDate, "invalid date"),
  elapsedDaysInWeek: z.number().int(),
  monthlyPenaltyTotal: z.number().int(),
  dailyTasks: z.array(TaskOverviewDailyTaskSchema),
  weeklyTasks: z.array(TaskOverviewWeeklyTaskSchema),
  weeklyReminders: z.array(ReminderOccurrenceSchema),
});
export const MonthlyTaskStatusItemSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  notes: z.string().max(500).optional(),
  type: TaskTypeSchema,
  penaltyPoints: z.number().int(),
  completed: z.boolean(),
  isDeleted: z.boolean(),
  completionSlots: z.array(TaskCompletionSlotSchema),
});
export const MonthlyTaskStatusGroupSchema = z.object({
  date: z.string().refine(isDate, "invalid date"),
  items: z.array(MonthlyTaskStatusItemSchema),
});
export const MonthlyPenaltySummarySchema = z.object({
  month: z.string(),
  teamId: z.string(),
  dailyPenaltyTotal: z.number().int(),
  weeklyPenaltyTotal: z.number().int(),
  totalPenalty: z.number().int(),
  isClosed: z.boolean(),
  triggeredPenaltyRuleIds: z.array(z.string()),
  taskStatusByDate: z.array(MonthlyTaskStatusGroupSchema),
});
export const CloseResponseSchema = z.object({
  closedAt: z.iso.datetime({ offset: true }),
  month: z.string(),
});
export const MonthCloseCandidateSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  dailyThroughDate: z.string().refine(isDate, "invalid date"),
  weeklyThroughDate: z.string().refine(isDate, "invalid date"),
});
export const MonthCloseCandidateResponseSchema = z.object({
  candidate: MonthCloseCandidateSchema.nullable(),
  pendingMonthCount: z.number().int().min(0),
});

export const teamStateSchema = z.object({
  teamId: z.uuid(),
  revision: z.string().regex(/^\d+$/),
});
export const operationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("getMe"),
    params: z.object({}).default({}),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("patchMeNickname"),
    params: z.object({}).default({}),
    body: UpdateNicknameRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("patchMeColor"),
    params: z.object({}).default({}),
    body: UpdateColorRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("postPushSubscription"),
    params: z.object({}).default({}),
    body: UpsertPushSubscriptionRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("deletePushSubscription"),
    params: z.object({ subscriptionId: z.string() }),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("getPushSubscriptionsMe"),
    params: z.object({}).default({}),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("postTeamInvite"),
    params: z.object({}).default({}),
    body: CreateInviteRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("getTeamCurrentInvite"),
    params: z.object({}).default({}),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("patchTeamCurrent"),
    params: z.object({}).default({}),
    body: UpdateCurrentTeamRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("getTeamCurrentMembers"),
    params: z.object({}).default({}),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("postTeamJoin"),
    params: z.object({}).default({}),
    body: JoinTeamRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("postTeamLeave"),
    params: z.object({}).default({}),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("listTasks"),
    params: z.object({ type: TaskTypeSchema.optional() }).default({}),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("postTask"),
    params: z.object({}).default({}),
    body: CreateTaskRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("postTasksReorder"),
    params: z.object({}).default({}),
    body: ReorderTasksRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("patchTask"),
    params: z.object({ taskId: z.string() }),
    body: UpdateTaskRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("deleteTask"),
    params: z.object({ taskId: z.string() }),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("postTaskCompletionToggle"),
    params: z.object({ taskId: z.string() }),
    body: ToggleTaskCompletionRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("listReminders"),
    params: z.object({
      from: z.string().refine(isDate, "invalid date"),
      to: z.string().refine(isDate, "invalid date"),
    }),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("postReminder"),
    params: z.object({}).default({}),
    body: CreateReminderRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("listReminderDefinitions"),
    params: z.object({}).default({}),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("patchReminder"),
    params: z.object({ reminderId: z.string() }),
    body: UpdateReminderRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("deleteReminder"),
    params: z.object({ reminderId: z.string() }),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("listPenaltyRules"),
    params: z.object({ includeDeleted: z.boolean().optional() }).default({}),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("postPenaltyRule"),
    params: z.object({}).default({}),
    body: CreatePenaltyRuleRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("patchPenaltyRule"),
    params: z.object({ ruleId: z.string() }),
    body: UpdatePenaltyRuleRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("deletePenaltyRule"),
    params: z.object({ ruleId: z.string() }),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("listShoppingItems"),
    params: z.object({}).default({}),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("postShoppingItem"),
    params: z.object({}).default({}),
    body: CreateShoppingListItemRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("patchShoppingItem"),
    params: z.object({ itemId: z.string() }),
    body: UpdateShoppingListItemRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("deleteShoppingItem"),
    params: z.object({ itemId: z.string() }),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("postShoppingItemsReorder"),
    params: z.object({}).default({}),
    body: ReorderShoppingListItemsRequestSchema,
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("getTaskOverview"),
    params: z.object({}).default({}),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("getPenaltySummaryMonthly"),
    params: z
      .object({
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional(),
      })
      .default({}),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("getMonthCloseCandidate"),
    params: z.object({}).default({}),
    expectedState: teamStateSchema.optional(),
  }),
  z.object({
    operation: z.literal("postMonthClose"),
    params: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
    expectedState: teamStateSchema.optional(),
  }),
]);
export type Operation = z.infer<typeof operationSchema>;
export type TeamState = z.infer<typeof teamStateSchema>;
export const responseSchemas = {
  getMe: MeResponseSchema,
  patchMeNickname: UpdateNicknameResponseSchema,
  patchMeColor: UpdateColorResponseSchema,
  postPushSubscription: PushSubscriptionSchema,
  deletePushSubscription: z.object({}),
  getPushSubscriptionsMe: ListPushSubscriptionsResponseSchema,
  postTeamInvite: InviteCodeResponseSchema,
  getTeamCurrentInvite: InviteCodeResponseSchema,
  patchTeamCurrent: TeamInfoResponseSchema,
  getTeamCurrentMembers: TeamMembersResponseSchema,
  postTeamJoin: JoinTeamResponseSchema,
  postTeamLeave: JoinTeamResponseSchema,
  listTasks: z.object({ items: z.array(TaskSchema) }),
  postTask: TaskSchema,
  postTasksReorder: z.object({ items: z.array(TaskSchema) }),
  patchTask: TaskSchema,
  deleteTask: z.object({}),
  postTaskCompletionToggle: TaskCompletionResponseSchema,
  listReminders: ReminderCalendarResponseSchema,
  postReminder: ReminderSchema,
  listReminderDefinitions: ReminderListResponseSchema,
  patchReminder: ReminderSchema,
  deleteReminder: z.object({}),
  listPenaltyRules: z.object({ items: z.array(PenaltyRuleSchema) }),
  postPenaltyRule: PenaltyRuleSchema,
  patchPenaltyRule: PenaltyRuleSchema,
  deletePenaltyRule: z.object({}),
  listShoppingItems: z.object({ items: z.array(ShoppingListItemSchema) }),
  postShoppingItem: ShoppingListItemSchema,
  patchShoppingItem: ShoppingListItemSchema,
  deleteShoppingItem: z.object({}),
  postShoppingItemsReorder: z.object({ items: z.array(ShoppingListItemSchema) }),
  getTaskOverview: TaskOverviewResponseSchema,
  getPenaltySummaryMonthly: MonthlyPenaltySummarySchema,
  getMonthCloseCandidate: MonthCloseCandidateResponseSchema,
  postMonthClose: CloseResponseSchema,
};
