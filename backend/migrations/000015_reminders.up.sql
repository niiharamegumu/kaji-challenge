CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('one_time', 'recurring')),
  schedule_type TEXT CHECK (schedule_type IN ('daily', 'weekly', 'monthly')),
  start_date DATE NOT NULL,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (
    (kind = 'one_time' AND schedule_type IS NULL AND end_date IS NULL)
    OR (kind = 'recurring' AND schedule_type IS NOT NULL)
  ),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_reminders_team_start_date
  ON reminders (team_id, start_date);

CREATE INDEX IF NOT EXISTS idx_reminders_team_kind_start_date
  ON reminders (team_id, kind, start_date);

CREATE INDEX IF NOT EXISTS idx_reminders_team_kind_schedule_start_date
  ON reminders (team_id, kind, schedule_type, start_date);
