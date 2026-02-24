CREATE INDEX IF NOT EXISTS idx_task_completion_daily_target_task
  ON task_completion_daily (target_date, task_id);

CREATE INDEX IF NOT EXISTS idx_task_completion_weekly_week_task
  ON task_completion_weekly (week_start, task_id);

CREATE INDEX IF NOT EXISTS idx_tasks_team_type_deleted_created
  ON tasks (team_id, type, deleted_at, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_team_assignee_deleted
  ON tasks (team_id, assignee_user_id, deleted_at);
