CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);

CREATE TABLE IF NOT EXISTS oauth_auth_requests (
  state TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_exchange_codes (
  code TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_exchange_codes_user_id ON oauth_exchange_codes (user_id);

CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER NOT NULL CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (used_count >= 0),
  CHECK (used_count <= max_uses)
);
CREATE INDEX IF NOT EXISTS idx_invite_codes_team_expires ON invite_codes (team_id, expires_at);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  type TEXT NOT NULL CHECK (type IN ('daily', 'weekly')),
  penalty_points INTEGER NOT NULL CHECK (penalty_points BETWEEN 0 AND 1000),
  assignee_user_id UUID,
  required_completions_per_week INTEGER NOT NULL DEFAULT 1 CHECK (required_completions_per_week >= 1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK ((type = 'daily' AND required_completions_per_week = 1) OR type = 'weekly'),
  FOREIGN KEY (team_id, assignee_user_id)
    REFERENCES team_members(team_id, user_id)
    ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_tasks_team_created ON tasks (team_id, created_at);

CREATE TABLE IF NOT EXISTS task_completions (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  target_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, target_date)
);

CREATE TABLE IF NOT EXISTS penalty_rules (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  threshold INTEGER NOT NULL CHECK (threshold >= 1),
  name TEXT NOT NULL,
  description TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_penalty_rules_team_threshold_undeleted
  ON penalty_rules (team_id, threshold)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_penalty_rules_team_name_undeleted
  ON penalty_rules (team_id, name)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_penalty_rules_team_threshold_undeleted
  ON penalty_rules (team_id, threshold)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_penalty_rules_team_effective_window
  ON penalty_rules (team_id, created_at, deleted_at);

CREATE TABLE IF NOT EXISTS monthly_penalty_summaries (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  month_start DATE NOT NULL,
  daily_penalty_total INTEGER NOT NULL DEFAULT 0,
  weekly_penalty_total INTEGER NOT NULL DEFAULT 0,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (team_id, month_start)
);

CREATE TABLE IF NOT EXISTS monthly_penalty_summary_triggered_rules (
  team_id UUID NOT NULL,
  month_start DATE NOT NULL,
  rule_id UUID NOT NULL REFERENCES penalty_rules(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, month_start, rule_id),
  FOREIGN KEY (team_id, month_start)
    REFERENCES monthly_penalty_summaries(team_id, month_start)
    ON DELETE CASCADE
);

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
