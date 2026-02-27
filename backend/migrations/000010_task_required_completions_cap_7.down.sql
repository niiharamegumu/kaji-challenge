ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_required_completions_per_week_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_required_completions_per_week_check
  CHECK (
    required_completions_per_week >= 1
  );
