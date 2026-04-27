ALTER TABLE shopping_items
  DROP CONSTRAINT IF EXISTS shopping_items_team_id_position_key;

ALTER TABLE shopping_items
  DROP CONSTRAINT IF EXISTS shopping_items_team_id_sort_key_key;

DROP INDEX IF EXISTS uq_tasks_team_type_position_undeleted;

DROP INDEX IF EXISTS uq_tasks_team_type_sort_key_undeleted;
