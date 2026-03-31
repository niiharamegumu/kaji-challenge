DROP INDEX IF EXISTS uq_tasks_team_type_position_undeleted;

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_position_check;

ALTER TABLE tasks
  DROP COLUMN IF EXISTS position;
