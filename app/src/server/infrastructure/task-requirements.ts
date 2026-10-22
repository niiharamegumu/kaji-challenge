import { sql, type SQL } from "drizzle-orm";

/** Use the same effective week for completion limits and historical recalculation. */
export function requiredForWeekSql(taskId: SQL, initial: SQL, week: SQL) {
  return sql<number>`COALESCE((
    SELECT r.required_completions_per_week FROM task_weekly_requirements r
    WHERE r.task_id = ${taskId} AND r.effective_week <= ${week}
    ORDER BY r.effective_week DESC LIMIT 1
  ), ${initial})`;
}
