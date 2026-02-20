DROP INDEX IF EXISTS idx_tasks_team_deleted_created;

ALTER TABLE tasks
DROP COLUMN IF EXISTS deleted_at;
