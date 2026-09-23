-- Fresh D1 database. Auth timestamps are epoch milliseconds; business timestamps are UTC ISO strings.
CREATE TABLE app_revision (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL CHECK(revision>=0)
);
INSERT INTO app_revision VALUES (1,0);

CREATE TABLE auth_user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN(0,1)),
  image TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);

CREATE TABLE auth_account (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  UNIQUE(provider_id,account_id)
);

CREATE INDEX auth_account_user_idx ON auth_account(user_id);

CREATE TABLE auth_session (
  id TEXT PRIMARY KEY NOT NULL,
  token TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);

CREATE INDEX auth_session_user_idx ON auth_session(user_id);

CREATE TRIGGER retain_five_sessions AFTER INSERT ON auth_session BEGIN
 DELETE FROM auth_session WHERE id IN (
  SELECT id FROM auth_session WHERE user_id=NEW.user_id AND id<>NEW.id ORDER BY created_at DESC,id DESC LIMIT -1 OFFSET 4
 );
END;

CREATE TABLE auth_verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);

CREATE INDEX auth_verification_identifier_idx ON auth_verification(identifier);

CREATE TABLE auth_rate_limit (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  last_request INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  nickname TEXT,
  color_hex TEXT CHECK(color_hex IS NULL OR (length(color_hex)=7 AND substr(color_hex,1,1)='#')),
  created_at TEXT NOT NULL
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  state_revision TEXT NOT NULL DEFAULT '0' CHECK(length(state_revision)>0 AND state_revision NOT GLOB '*[^0-9]*')
);

CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK(role IN('owner','member')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(team_id,user_id),
  UNIQUE(user_id)
);

CREATE TABLE invite_codes (
  code TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX invite_team_idx ON invite_codes(team_id,created_at);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  type TEXT NOT NULL CHECK(type IN('daily','weekly')),
  penalty_points INTEGER NOT NULL CHECK(penalty_points BETWEEN 0 AND 1000),
  assignee_user_id TEXT,
  required_completions_per_week INTEGER NOT NULL CHECK(required_completions_per_week BETWEEN 1 AND 7),
  sort_key INTEGER NOT NULL CHECK(sort_key>=1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK(type='weekly' OR required_completions_per_week=1),
  FOREIGN KEY(team_id,assignee_user_id) REFERENCES team_members(team_id,user_id) ON DELETE RESTRICT
);

CREATE INDEX tasks_team_sort_idx ON tasks(team_id,type,sort_key,created_at);

CREATE TABLE task_completion_daily (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  target_date TEXT NOT NULL,
  completed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(task_id,target_date)
);

CREATE TABLE task_completion_weekly_entries (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  completed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX weekly_task_week_idx ON task_completion_weekly_entries(task_id,week_start,created_at,id);

CREATE TABLE shopping_items (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT,
  sort_key INTEGER NOT NULL CHECK(sort_key>=1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX shopping_team_sort_idx ON shopping_items(team_id,sort_key,created_at);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  kind TEXT NOT NULL CHECK(kind IN('one_time','recurring')),
  schedule_type TEXT CHECK(schedule_type IN('daily','weekly','monthly')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((kind='one_time' AND schedule_type IS NULL AND end_date IS NULL) OR (kind='recurring' AND schedule_type IS NOT NULL)),
  CHECK(end_date IS NULL OR end_date>=start_date)
);

CREATE INDEX reminders_team_date_idx ON reminders(team_id,start_date);

CREATE TABLE penalty_rules (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  threshold INTEGER NOT NULL CHECK(threshold>=1),
  name TEXT NOT NULL,
  description TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX penalty_threshold_uq ON penalty_rules(team_id,threshold) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX penalty_name_uq ON penalty_rules(team_id,name) WHERE deleted_at IS NULL;
CREATE TABLE monthly_penalty_summaries (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  month_start TEXT NOT NULL,
  daily_penalty_total INTEGER NOT NULL DEFAULT 0 CHECK(daily_penalty_total>=0),
  weekly_penalty_total INTEGER NOT NULL DEFAULT 0 CHECK(weekly_penalty_total>=0),
  is_closed INTEGER NOT NULL DEFAULT 0 CHECK(is_closed IN(0,1)),
  PRIMARY KEY(team_id,month_start)
);

CREATE TABLE monthly_penalty_summary_triggered_rules (
  team_id TEXT NOT NULL,
  month_start TEXT NOT NULL,
  rule_id TEXT NOT NULL REFERENCES penalty_rules(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(team_id,month_start,rule_id),
  FOREIGN KEY(team_id,month_start) REFERENCES monthly_penalty_summaries(team_id,month_start) ON DELETE CASCADE
);

CREATE TABLE close_runs (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK(scope IN('close_day','close_week')),
  target_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(team_id,scope,target_date)
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  platform TEXT NOT NULL CHECK(platform='ios_safari_pwa'),
  is_active INTEGER NOT NULL CHECK(is_active IN(0,1)),
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(team_id,user_id)
);

CREATE INDEX push_user_idx ON push_subscriptions(user_id,is_active);

CREATE TABLE push_delivery (
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK(slot IN('daily_2100','weekly_prev_sat_1900','weekly_due_sun_1000')),
  target_date TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  sent_at INTEGER,
  PRIMARY KEY(subscription_id,slot,target_date,endpoint_hash)
);
