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

INSERT INTO task_completion_weekly (
  task_id,
  week_start,
  completion_count,
  created_at,
  updated_at
)
SELECT
  e.task_id,
  e.week_start,
  COUNT(*)::integer AS completion_count,
  MIN(e.created_at) AS created_at,
  MAX(e.created_at) AS updated_at
FROM task_completion_weekly_entries e
GROUP BY e.task_id, e.week_start
ON CONFLICT (task_id, week_start) DO UPDATE
SET completion_count = EXCLUDED.completion_count,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

DROP TABLE IF EXISTS task_completion_weekly_entries;

DROP INDEX IF EXISTS idx_task_completion_daily_user;

ALTER TABLE task_completion_daily
  DROP COLUMN IF EXISTS completed_by_user_id;
