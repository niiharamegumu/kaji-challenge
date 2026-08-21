ALTER TABLE close_runs DROP CONSTRAINT close_runs_scope_check;
ALTER TABLE close_runs
  ADD CONSTRAINT close_runs_scope_check CHECK (scope IN ('close_day', 'close_week', 'close_month'));

CREATE TABLE IF NOT EXISTS task_evaluation_dedupes (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('penalty_day', 'penalty_week')),
  target_date DATE NOT NULL,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, scope, target_date, task_id)
);
