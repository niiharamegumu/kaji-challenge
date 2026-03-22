CREATE TABLE IF NOT EXISTS shopping_items (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity TEXT,
  notes TEXT,
  position INTEGER NOT NULL CHECK (position >= 1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (team_id, position)
);
