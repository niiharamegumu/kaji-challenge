ALTER TABLE shopping_items
  ADD CONSTRAINT shopping_items_team_id_position_key UNIQUE (team_id, position);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_team_type_position_undeleted
  ON tasks (team_id, type, position)
  WHERE deleted_at IS NULL;
