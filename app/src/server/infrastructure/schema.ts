import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  foreignKey,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

// Runtime mapping of the deployed D1 schema. SQL migrations remain the DDL source of truth.
export const teams = sqliteTable("teams", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  created_at: text("created_at").notNull(),
});

export const inviteCodes = sqliteTable(
  "invite_codes",
  {
    code: text("code").primaryKey().notNull(),
    team_id: text("team_id").notNull(),
    expires_at: text("expires_at").notNull(),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.team_id], foreignColumns: [teams.id] }).onDelete("cascade"),
    index("invite_team_idx").on(t.team_id, t.created_at),
  ],
);

export const shoppingItems = sqliteTable(
  "shopping_items",
  {
    id: text("id").primaryKey().notNull(),
    team_id: text("team_id").notNull(),
    name: text("name").notNull(),
    notes: text("notes"),
    sort_key: integer("sort_key").notNull(),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.team_id], foreignColumns: [teams.id] }).onDelete("cascade"),
    index("shopping_team_sort_idx").on(t.team_id, t.sort_key, t.created_at),
    check("shopping_items_check_1", sql`${t.sort_key}>=1`),
  ],
);

export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey().notNull(),
    team_id: text("team_id").notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    kind: text("kind").notNull(),
    schedule_type: text("schedule_type"),
    start_date: text("start_date").notNull(),
    end_date: text("end_date"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.team_id], foreignColumns: [teams.id] }).onDelete("cascade"),
    index("reminders_team_date_idx").on(t.team_id, t.start_date),
    check("reminders_check_1", sql`${t.kind} IN('one_time','recurring')`),
    check("reminders_check_2", sql`${t.schedule_type} IN('daily','weekly','monthly')`),
    check(
      "reminders_check_3",
      sql`(${t.kind}='one_time' AND ${t.schedule_type} IS NULL AND ${t.end_date} IS NULL) OR (${t.kind}='recurring' AND ${t.schedule_type} IS NOT NULL)`,
    ),
    check("reminders_check_4", sql`${t.end_date} IS NULL OR ${t.end_date}>=${t.start_date}`),
  ],
);

export const penaltyRules = sqliteTable(
  "penalty_rules",
  {
    id: text("id").primaryKey().notNull(),
    team_id: text("team_id").notNull(),
    threshold: integer("threshold").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    deleted_at: text("deleted_at"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.team_id], foreignColumns: [teams.id] }).onDelete("cascade"),
    uniqueIndex("penalty_name_uq")
      .on(t.team_id, t.name)
      .where(sql`${t.deleted_at} IS NULL`),
    uniqueIndex("penalty_threshold_uq")
      .on(t.team_id, t.threshold)
      .where(sql`${t.deleted_at} IS NULL`),
    check("penalty_rules_check_1", sql`${t.threshold}>=1`),
  ],
);

export const monthlyPenaltySummaries = sqliteTable(
  "monthly_penalty_summaries",
  {
    team_id: text("team_id").notNull(),
    month_start: text("month_start").notNull(),
    daily_penalty_total: integer("daily_penalty_total")
      .notNull()
      .default(sql`0`),
    weekly_penalty_total: integer("weekly_penalty_total")
      .notNull()
      .default(sql`0`),
    is_closed: integer("is_closed")
      .notNull()
      .default(sql`0`),
  },
  (t) => [
    primaryKey({ columns: [t.team_id, t.month_start] }),
    foreignKey({ columns: [t.team_id], foreignColumns: [teams.id] }).onDelete("cascade"),
    check("monthly_penalty_summaries_check_1", sql`${t.daily_penalty_total}>=0`),
    check("monthly_penalty_summaries_check_2", sql`${t.weekly_penalty_total}>=0`),
    check("monthly_penalty_summaries_check_3", sql`${t.is_closed} IN(0,1)`),
  ],
);

export const monthlyPenaltySummaryTriggeredRules = sqliteTable(
  "monthly_penalty_summary_triggered_rules",
  {
    team_id: text("team_id").notNull(),
    month_start: text("month_start").notNull(),
    rule_id: text("rule_id").notNull(),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.team_id, t.month_start, t.rule_id] }),
    foreignKey({
      columns: [t.team_id, t.month_start],
      foreignColumns: [monthlyPenaltySummaries.team_id, monthlyPenaltySummaries.month_start],
    }).onDelete("cascade"),
    foreignKey({ columns: [t.rule_id], foreignColumns: [penaltyRules.id] }).onDelete("cascade"),
  ],
);

export const closeRuns = sqliteTable(
  "close_runs",
  {
    team_id: text("team_id").notNull(),
    scope: text("scope").notNull(),
    target_date: text("target_date").notNull(),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.team_id, t.scope, t.target_date] }),
    foreignKey({ columns: [t.team_id], foreignColumns: [teams.id] }).onDelete("cascade"),
    check("close_runs_check_1", sql`${t.scope} IN('close_day','close_week')`),
  ],
);

export const teamMembers = sqliteTable(
  "team_members",
  {
    team_id: text("team_id").notNull(),
    user_id: text("user_id").notNull(),
    role: text("role").notNull(),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.team_id, t.user_id] }),
    foreignKey({ columns: [t.user_id], foreignColumns: [user.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.team_id], foreignColumns: [teams.id] }).onDelete("cascade"),
    uniqueIndex("team_members_user_id_uq").on(t.user_id),
    check("team_members_check_1", sql`${t.role} IN('owner','member')`),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey().notNull(),
    team_id: text("team_id").notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    type: text("type").notNull(),
    penalty_points: integer("penalty_points").notNull(),
    assignee_user_id: text("assignee_user_id"),
    required_completions_per_week: integer("required_completions_per_week").notNull(),
    sort_key: integer("sort_key").notNull(),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.team_id, t.assignee_user_id],
      foreignColumns: [teamMembers.team_id, teamMembers.user_id],
    }).onDelete("restrict"),
    foreignKey({ columns: [t.team_id], foreignColumns: [teams.id] }).onDelete("cascade"),
    index("tasks_team_sort_idx").on(t.team_id, t.type, t.sort_key, t.created_at),
    check("tasks_check_1", sql`${t.type} IN('daily','weekly')`),
    check("tasks_check_2", sql`${t.penalty_points} BETWEEN 0 AND 1000`),
    check("tasks_check_3", sql`${t.required_completions_per_week} BETWEEN 1 AND 7`),
    check("tasks_check_4", sql`${t.sort_key}>=1`),
    check("tasks_check_5", sql`${t.type}='weekly' OR ${t.required_completions_per_week}=1`),
  ],
);

export const taskCompletionDaily = sqliteTable(
  "task_completion_daily",
  {
    task_id: text("task_id").notNull(),
    target_date: text("target_date").notNull(),
    completed_by_user_id: text("completed_by_user_id"),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.task_id, t.target_date] }),
    foreignKey({ columns: [t.completed_by_user_id], foreignColumns: [user.id] }).onDelete(
      "set null",
    ),
    foreignKey({ columns: [t.task_id], foreignColumns: [tasks.id] }).onDelete("cascade"),
  ],
);

export const taskCompletionWeeklyEntries = sqliteTable(
  "task_completion_weekly_entries",
  {
    id: text("id").primaryKey().notNull(),
    task_id: text("task_id").notNull(),
    week_start: text("week_start").notNull(),
    completed_by_user_id: text("completed_by_user_id"),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.completed_by_user_id], foreignColumns: [user.id] }).onDelete(
      "set null",
    ),
    foreignKey({ columns: [t.task_id], foreignColumns: [tasks.id] }).onDelete("cascade"),
    index("weekly_task_week_idx").on(t.task_id, t.week_start, t.created_at, t.id),
  ],
);

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey().notNull(),
    team_id: text("team_id").notNull(),
    user_id: text("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    user_agent: text("user_agent"),
    platform: text("platform").notNull(),
    is_active: integer("is_active").notNull(),
    last_seen_at: text("last_seen_at").notNull(),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.user_id], foreignColumns: [user.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.team_id], foreignColumns: [teams.id] }).onDelete("cascade"),
    index("push_user_idx").on(t.user_id, t.is_active),
    uniqueIndex("push_subscriptions_team_id_user_id_uq").on(t.team_id, t.user_id),
    uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint),
    check("push_subscriptions_check_1", sql`${t.platform}='ios_safari_pwa'`),
    check("push_subscriptions_check_2", sql`${t.is_active} IN(0,1)`),
  ],
);

export const pushDelivery = sqliteTable(
  "push_delivery",
  {
    subscription_id: text("subscription_id").notNull(),
    slot: text("slot").notNull(),
    target_date: text("target_date").notNull(),
    endpoint_hash: text("endpoint_hash").notNull(),
    claim_id: text("claim_id").notNull(),
    lease_until: text("lease_until").notNull(),
    attempts: integer("attempts")
      .notNull()
      .default(sql`1`),
    sent_at: text("sent_at"),
  },
  (t) => [
    primaryKey({ columns: [t.subscription_id, t.slot, t.target_date, t.endpoint_hash] }),
    foreignKey({ columns: [t.subscription_id], foreignColumns: [pushSubscriptions.id] }).onDelete(
      "cascade",
    ),
    check(
      "push_delivery_check_1",
      sql`${t.slot} IN('daily_2100','weekly_prev_sat_1900','weekly_due_sun_1000')`,
    ),
  ],
);
