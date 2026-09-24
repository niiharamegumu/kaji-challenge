-- Store every application timestamp as UTC ISO 8601 TEXT with millisecond precision.

-- Snapshot dependents before replacing auth_user: DROP may CASCADE or SET NULL.

-- The migration runner executes this file atomically; do not run statements separately.

CREATE TABLE _saved_auth_user AS SELECT * FROM auth_user;

CREATE TABLE _saved_auth_account AS SELECT * FROM auth_account;

CREATE TABLE _saved_auth_session AS SELECT * FROM auth_session;

CREATE TABLE _saved_auth_verification AS SELECT * FROM auth_verification;

CREATE TABLE _saved_auth_rate_limit AS SELECT * FROM auth_rate_limit;

CREATE TABLE _saved_team_members AS SELECT * FROM team_members;

CREATE TABLE _saved_tasks AS SELECT * FROM tasks;

CREATE TABLE _saved_task_completion_daily AS SELECT * FROM task_completion_daily;

CREATE TABLE _saved_task_completion_weekly_entries AS SELECT * FROM task_completion_weekly_entries;

CREATE TABLE _saved_push_subscriptions AS SELECT * FROM push_subscriptions;

CREATE TABLE _saved_push_delivery AS SELECT * FROM push_delivery;

DROP TABLE push_delivery;

DROP TABLE push_subscriptions;

DROP TABLE task_completion_weekly_entries;

DROP TABLE task_completion_daily;

DROP TABLE tasks;

DROP TABLE team_members;

DROP TABLE auth_rate_limit;

DROP TABLE auth_verification;

DROP TABLE auth_session;

DROP TABLE auth_account;

DROP TABLE auth_user;

CREATE TABLE auth_user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN(0,1)),
  image TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  nickname TEXT CHECK(nickname IS NULL OR length(nickname)<=30),
  color_hex TEXT CHECK(color_hex IS NULL OR (length(color_hex)=7 AND substr(color_hex,1,1)='#' AND substr(color_hex,2) NOT GLOB '*[^0-9A-Fa-f]*'))
);

INSERT INTO auth_user (id,name,email,email_verified,image,created_at,updated_at,nickname,color_hex)
SELECT id,name,email,email_verified,image,strftime('%Y-%m-%dT%H:%M:%fZ',created_at/1000.0,'unixepoch'),strftime('%Y-%m-%dT%H:%M:%fZ',updated_at/1000.0,'unixepoch'),nickname,color_hex FROM _saved_auth_user;

DROP TABLE _saved_auth_user;

CREATE TABLE auth_account (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scope TEXT,
  password TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(provider_id,account_id)
);

INSERT INTO auth_account (id,user_id,provider_id,account_id,access_token,refresh_token,id_token,access_token_expires_at,refresh_token_expires_at,scope,password,created_at,updated_at)
SELECT id,user_id,provider_id,account_id,access_token,refresh_token,id_token,strftime('%Y-%m-%dT%H:%M:%fZ',access_token_expires_at/1000.0,'unixepoch'),strftime('%Y-%m-%dT%H:%M:%fZ',refresh_token_expires_at/1000.0,'unixepoch'),scope,password,strftime('%Y-%m-%dT%H:%M:%fZ',created_at/1000.0,'unixepoch'),strftime('%Y-%m-%dT%H:%M:%fZ',updated_at/1000.0,'unixepoch') FROM _saved_auth_account;

DROP TABLE _saved_auth_account;

CREATE INDEX auth_account_user_idx ON auth_account(user_id);

CREATE TABLE auth_session (
  id TEXT PRIMARY KEY NOT NULL,
  token TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO auth_session (id,token,user_id,expires_at,ip_address,user_agent,created_at,updated_at)
SELECT id,token,user_id,strftime('%Y-%m-%dT%H:%M:%fZ',expires_at/1000.0,'unixepoch'),ip_address,user_agent,strftime('%Y-%m-%dT%H:%M:%fZ',created_at/1000.0,'unixepoch'),strftime('%Y-%m-%dT%H:%M:%fZ',updated_at/1000.0,'unixepoch') FROM _saved_auth_session;

DROP TABLE _saved_auth_session;

CREATE INDEX auth_session_user_idx ON auth_session(user_id);

CREATE TABLE auth_verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO auth_verification (id,identifier,value,expires_at,created_at,updated_at)
SELECT id,identifier,value,strftime('%Y-%m-%dT%H:%M:%fZ',expires_at/1000.0,'unixepoch'),strftime('%Y-%m-%dT%H:%M:%fZ',created_at/1000.0,'unixepoch'),strftime('%Y-%m-%dT%H:%M:%fZ',updated_at/1000.0,'unixepoch') FROM _saved_auth_verification;

DROP TABLE _saved_auth_verification;

CREATE INDEX auth_verification_identifier_idx ON auth_verification(identifier);

CREATE TABLE auth_rate_limit (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  last_request TEXT NOT NULL
);

INSERT INTO auth_rate_limit (id,key,count,last_request)
SELECT id,key,count,strftime('%Y-%m-%dT%H:%M:%fZ',last_request/1000.0,'unixepoch') FROM _saved_auth_rate_limit;

DROP TABLE _saved_auth_rate_limit;

CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK(role IN('owner','member')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(team_id,user_id),
  UNIQUE(user_id)
);

INSERT INTO team_members (team_id,user_id,role,created_at)
SELECT team_id,user_id,role,created_at FROM _saved_team_members;

DROP TABLE _saved_team_members;

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

INSERT INTO tasks (id,team_id,title,notes,type,penalty_points,assignee_user_id,required_completions_per_week,sort_key,created_at,updated_at,deleted_at)
SELECT id,team_id,title,notes,type,penalty_points,assignee_user_id,required_completions_per_week,sort_key,created_at,updated_at,deleted_at FROM _saved_tasks;

DROP TABLE _saved_tasks;

CREATE INDEX tasks_team_sort_idx ON tasks(team_id,type,sort_key,created_at);

CREATE TABLE task_completion_daily (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  target_date TEXT NOT NULL,
  completed_by_user_id TEXT REFERENCES auth_user(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(task_id,target_date)
);

INSERT INTO task_completion_daily (task_id,target_date,completed_by_user_id,created_at)
SELECT task_id,target_date,completed_by_user_id,created_at FROM _saved_task_completion_daily;

DROP TABLE _saved_task_completion_daily;

CREATE TABLE task_completion_weekly_entries (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  completed_by_user_id TEXT REFERENCES auth_user(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

INSERT INTO task_completion_weekly_entries (id,task_id,week_start,completed_by_user_id,created_at)
SELECT id,task_id,week_start,completed_by_user_id,created_at FROM _saved_task_completion_weekly_entries;

DROP TABLE _saved_task_completion_weekly_entries;

CREATE INDEX weekly_task_week_idx ON task_completion_weekly_entries(task_id,week_start,created_at,id);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
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

INSERT INTO push_subscriptions (id,team_id,user_id,endpoint,p256dh,auth,user_agent,platform,is_active,last_seen_at,created_at,updated_at)
SELECT id,team_id,user_id,endpoint,p256dh,auth,user_agent,platform,is_active,last_seen_at,created_at,updated_at FROM _saved_push_subscriptions;

DROP TABLE _saved_push_subscriptions;

CREATE INDEX push_user_idx ON push_subscriptions(user_id,is_active);

CREATE TABLE push_delivery (
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK(slot IN('daily_2100','weekly_prev_sat_1900','weekly_due_sun_1000')),
  target_date TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  sent_at TEXT,
  PRIMARY KEY(subscription_id,slot,target_date,endpoint_hash)
);

INSERT INTO push_delivery (subscription_id,slot,target_date,endpoint_hash,claim_id,lease_until,attempts,sent_at)
SELECT subscription_id,slot,target_date,endpoint_hash,claim_id,strftime('%Y-%m-%dT%H:%M:%fZ',lease_until/1000.0,'unixepoch'),attempts,strftime('%Y-%m-%dT%H:%M:%fZ',sent_at/1000.0,'unixepoch') FROM _saved_push_delivery;

DROP TABLE _saved_push_delivery;

CREATE TRIGGER retain_five_sessions AFTER INSERT ON auth_session BEGIN
 DELETE FROM auth_session WHERE id IN (
  SELECT id FROM auth_session WHERE user_id=NEW.user_id AND id<>NEW.id ORDER BY created_at DESC,id DESC LIMIT -1 OFFSET 4
 );
END;
