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
