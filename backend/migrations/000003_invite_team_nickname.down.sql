ALTER TABLE invite_codes
  ADD COLUMN IF NOT EXISTS max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  ADD COLUMN IF NOT EXISTS used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0);

ALTER TABLE invite_codes
  DROP CONSTRAINT IF EXISTS invite_codes_used_count_max_uses_check;

ALTER TABLE invite_codes
  ADD CONSTRAINT invite_codes_used_count_max_uses_check CHECK (used_count <= max_uses);

ALTER TABLE teams
  DROP COLUMN IF EXISTS name;

ALTER TABLE users
  DROP COLUMN IF EXISTS nickname;
