CREATE TABLE IF NOT EXISTS close_runs (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('close_day', 'close_week', 'close_month')),
  target_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, scope, target_date)
);

CREATE TABLE IF NOT EXISTS task_evaluation_dedupes (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('penalty_day', 'penalty_week')),
  target_date DATE NOT NULL,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, scope, target_date, task_id)
);

DROP TABLE IF EXISTS close_executions;
