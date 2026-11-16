CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  todo_completion_delay_ms INTEGER NOT NULL DEFAULT 3000
    CHECK (todo_completion_delay_ms IN (1000, 2000, 3000, 4000, 5000)),
  default_todo_category TEXT NOT NULL DEFAULT '{"kind":"all"}'
    CHECK (json_valid(default_todo_category) AND COALESCE(
      json_extract(default_todo_category, '$.kind') IN ('all', 'unclassified') OR (
        json_extract(default_todo_category, '$.kind') = 'category' AND
        json_type(default_todo_category, '$.id') = 'text' AND
        length(json_extract(default_todo_category, '$.id')) BETWEEN 1 AND 128
      ), 0))
);
