CREATE TABLE IF NOT EXISTS close_executions (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('close_day', 'close_week', 'close_month', 'penalty_day', 'penalty_week')),
  target_date DATE NOT NULL,
  task_id UUID,
  dedupe_task_key TEXT GENERATED ALWAYS AS (COALESCE(task_id::text, 'none')) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_close_executions_dedupe
  ON close_executions(team_id, scope, target_date, dedupe_task_key);

DROP TABLE IF EXISTS task_evaluation_dedupes;
DROP TABLE IF EXISTS close_runs;
