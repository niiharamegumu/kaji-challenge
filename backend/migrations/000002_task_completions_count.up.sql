ALTER TABLE task_completions RENAME TO task_completion_daily;

CREATE TABLE IF NOT EXISTS task_completion_weekly (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  completion_count INTEGER NOT NULL DEFAULT 0 CHECK (completion_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_task_completion_weekly_week_start
  ON task_completion_weekly (week_start);

INSERT INTO task_completion_weekly (task_id, week_start, completion_count, created_at, updated_at)
SELECT
  tc.task_id,
  DATE_TRUNC('week', tc.target_date::timestamp)::date AS week_start,
  COUNT(*)::integer AS completion_count,
  MIN(tc.created_at) AS created_at,
  MAX(tc.created_at) AS updated_at
FROM task_completion_daily tc
INNER JOIN tasks t ON t.id = tc.task_id
WHERE t.type = 'weekly'
GROUP BY tc.task_id, DATE_TRUNC('week', tc.target_date::timestamp)::date
ON CONFLICT (task_id, week_start) DO UPDATE
SET completion_count = EXCLUDED.completion_count,
    updated_at = NOW();

DELETE FROM task_completion_daily d
USING tasks t
WHERE t.id = d.task_id
  AND t.type = 'weekly';
