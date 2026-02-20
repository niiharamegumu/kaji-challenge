ALTER TABLE tasks
ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_team_deleted_created
  ON tasks (team_id, deleted_at, created_at);
