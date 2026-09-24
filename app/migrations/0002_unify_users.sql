-- Consolidate application identity into Better Auth without losing business history.
ALTER TABLE auth_user ADD COLUMN nickname TEXT CHECK(nickname IS NULL OR length(nickname)<=30);
ALTER TABLE auth_user ADD COLUMN color_hex TEXT CHECK(color_hex IS NULL OR (length(color_hex)=7 AND substr(color_hex,1,1)='#' AND substr(color_hex,2) NOT GLOB '*[^0-9A-Fa-f]*'));
UPDATE auth_user SET
  nickname=(SELECT nickname FROM users WHERE users.id=auth_user.id),
  color_hex=(SELECT color_hex FROM users WHERE users.id=auth_user.id);

-- Copies have no foreign keys: parent replacement must not cascade into saved rows.

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

DROP TABLE users;

-- Recreate only the tables whose user FK, or dependent FK, changes.

CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK(role IN('owner','member')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(team_id,user_id),
  UNIQUE(user_id)
);

INSERT INTO team_members SELECT * FROM _saved_team_members;

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

CREATE INDEX tasks_team_sort_idx ON tasks(team_id,type,sort_key,created_at);

INSERT INTO tasks SELECT * FROM _saved_tasks;

DROP TABLE _saved_tasks;

CREATE TABLE task_completion_daily (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  target_date TEXT NOT NULL,
  completed_by_user_id TEXT REFERENCES auth_user(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(task_id,target_date)
);

INSERT INTO task_completion_daily SELECT * FROM _saved_task_completion_daily;

DROP TABLE _saved_task_completion_daily;

CREATE TABLE task_completion_weekly_entries (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  completed_by_user_id TEXT REFERENCES auth_user(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX weekly_task_week_idx ON task_completion_weekly_entries(task_id,week_start,created_at,id);

INSERT INTO task_completion_weekly_entries SELECT * FROM _saved_task_completion_weekly_entries;

DROP TABLE _saved_task_completion_weekly_entries;

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

CREATE INDEX push_user_idx ON push_subscriptions(user_id,is_active);

INSERT INTO push_subscriptions SELECT * FROM _saved_push_subscriptions;

DROP TABLE _saved_push_subscriptions;

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

INSERT INTO push_delivery SELECT * FROM _saved_push_delivery;

DROP TABLE _saved_push_delivery;
