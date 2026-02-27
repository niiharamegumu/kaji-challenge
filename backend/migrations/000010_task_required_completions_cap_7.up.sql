UPDATE tasks
SET required_completions_per_week = 7
WHERE type = 'weekly'
  AND required_completions_per_week > 7;

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_required_completions_per_week_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_required_completions_per_week_check
  CHECK (
    required_completions_per_week BETWEEN 1 AND 7
  );
