ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_color_hex_format_chk;

ALTER TABLE users
  DROP COLUMN IF EXISTS color_hex;
