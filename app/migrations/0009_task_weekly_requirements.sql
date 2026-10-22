CREATE TABLE task_weekly_requirements (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  effective_week TEXT NOT NULL,
  required_completions_per_week INTEGER NOT NULL CHECK (required_completions_per_week BETWEEN 1 AND 7),
  PRIMARY KEY (task_id, effective_week),
  CHECK (length(effective_week) = 10 AND strftime('%w', effective_week) IS '1')
);
