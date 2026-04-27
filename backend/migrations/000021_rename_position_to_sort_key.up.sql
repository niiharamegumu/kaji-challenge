ALTER TABLE shopping_items
  RENAME COLUMN position TO sort_key;

ALTER TABLE tasks
  RENAME COLUMN position TO sort_key;

ALTER TABLE shopping_items
  RENAME CONSTRAINT shopping_items_position_check TO shopping_items_sort_key_check;

ALTER TABLE tasks
  RENAME CONSTRAINT tasks_position_check TO tasks_sort_key_check;
