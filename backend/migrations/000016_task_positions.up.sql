ALTER TABLE tasks
  ADD COLUMN position INTEGER;

WITH ranked_tasks AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY team_id, type
      ORDER BY created_at, id
    ) AS next_position
  FROM tasks
)
UPDATE tasks
SET position = ranked_tasks.next_position
FROM ranked_tasks
WHERE tasks.id = ranked_tasks.id;

ALTER TABLE tasks
  ALTER COLUMN position SET NOT NULL;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_position_check CHECK (position >= 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_team_type_position_undeleted
  ON tasks (team_id, type, position)
  WHERE deleted_at IS NULL;
