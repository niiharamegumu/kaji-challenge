ALTER TABLE shopping_items
  RENAME CONSTRAINT shopping_items_sort_key_check TO shopping_items_position_check;

ALTER TABLE tasks
  RENAME CONSTRAINT tasks_sort_key_check TO tasks_position_check;

ALTER TABLE shopping_items
  RENAME COLUMN sort_key TO position;

ALTER TABLE tasks
  RENAME COLUMN sort_key TO position;
