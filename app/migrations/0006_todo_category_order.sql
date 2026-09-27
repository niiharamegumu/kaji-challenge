-- The JSON category array stores named-category order; this key inserts the virtual
-- unclassified category without storing it as a registered category.
ALTER TABLE teams ADD COLUMN todo_unclassified_sort_key INTEGER NOT NULL DEFAULT 0
  CHECK(todo_unclassified_sort_key >= 0
    AND todo_unclassified_sort_key <= json_array_length(todo_categories));
