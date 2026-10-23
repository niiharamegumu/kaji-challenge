-- Persistent trial quota. No user identifiers, audio or transcripts are retained.
CREATE TABLE assist_usage (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'voice'),
  window_start INTEGER NOT NULL,
  window_count INTEGER NOT NULL CHECK (window_count >= 0),
  usage_day TEXT NOT NULL,
  daily_count INTEGER NOT NULL CHECK (daily_count >= 0),
  total_count INTEGER NOT NULL CHECK (total_count >= 0)
);
-- Seed exactly once. Missing quota state must fail closed, never silently reset the trial.
INSERT INTO assist_usage VALUES ('voice', 0, 0, '', 0, 0);
