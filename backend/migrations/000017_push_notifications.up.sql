CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('ios_safari_pwa')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_active
  ON push_subscriptions (user_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_team_active
  ON push_subscriptions (team_id, is_active, updated_at DESC);

CREATE TABLE IF NOT EXISTS push_dispatch_state (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slot_kind TEXT NOT NULL CHECK (
    slot_kind IN ('daily_2100', 'weekly_prev_sat_1900', 'weekly_due_sun_1000')
  ),
  slot_date DATE NOT NULL,
  fingerprint TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, slot_kind, slot_date)
);

CREATE INDEX IF NOT EXISTS idx_push_dispatch_state_slot
  ON push_dispatch_state (slot_kind, slot_date);
