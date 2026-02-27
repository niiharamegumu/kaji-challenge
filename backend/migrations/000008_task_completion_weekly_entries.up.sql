ALTER TABLE task_completion_daily
  ADD COLUMN IF NOT EXISTS completed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_task_completion_daily_user
  ON task_completion_daily (completed_by_user_id);

CREATE TABLE IF NOT EXISTS task_completion_weekly_entries (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  completed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_completion_weekly_entries_task_week_created
  ON task_completion_weekly_entries (task_id, week_start, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_task_completion_weekly_entries_week_task
  ON task_completion_weekly_entries (week_start, task_id);

INSERT INTO task_completion_weekly_entries (
  id,
  task_id,
  week_start,
  completed_by_user_id,
  created_at
)
SELECT
  md5(tcw.task_id::text || ':' || tcw.week_start::text || ':' || gs.ordinality::text)::uuid AS id,
  tcw.task_id,
  tcw.week_start,
  NULL::uuid AS completed_by_user_id,
  (tcw.week_start::timestamp + make_interval(secs => gs.ordinality))::timestamptz AS created_at
FROM task_completion_weekly tcw
JOIN LATERAL generate_series(1, GREATEST(tcw.completion_count, 0)) WITH ORDINALITY AS gs(val, ordinality) ON TRUE
ON CONFLICT (id) DO NOTHING;

DROP TABLE IF EXISTS task_completion_weekly;
