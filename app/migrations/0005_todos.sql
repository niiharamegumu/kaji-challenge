-- Replace the shopping table in place; preserve identifiers, order and timestamps.
ALTER TABLE shopping_items RENAME TO todo_items;
DROP INDEX shopping_team_sort_idx;
CREATE INDEX todo_team_sort_idx ON todo_items(team_id, sort_key, created_at);
ALTER TABLE todo_items ADD COLUMN category TEXT;
ALTER TABLE teams ADD COLUMN todo_categories TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(todo_categories) AND json_type(todo_categories) = 'array');
