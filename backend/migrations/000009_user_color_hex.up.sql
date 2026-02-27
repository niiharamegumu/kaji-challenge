ALTER TABLE users
  ADD COLUMN IF NOT EXISTS color_hex TEXT;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_color_hex_format_chk;

ALTER TABLE users
  ADD CONSTRAINT users_color_hex_format_chk
  CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9A-F]{6}$');
