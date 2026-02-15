-- name: CreateTaskCompletion :exec
INSERT INTO task_completions (task_id, target_date, created_at)
VALUES ($1, $2, NOW())
ON CONFLICT (task_id, target_date) DO NOTHING;

-- name: DeleteTaskCompletion :exec
DELETE FROM task_completions
WHERE task_id = $1 AND target_date = $2;

-- name: HasTaskCompletion :one
SELECT EXISTS (
  SELECT 1
  FROM task_completions
  WHERE task_id = $1 AND target_date = $2
);

-- name: CountTaskCompletionsInRange :one
SELECT COUNT(*)::bigint
FROM task_completions
WHERE task_id = $1
  AND target_date >= $2
  AND target_date <= $3;

-- name: DeleteTaskCompletionsByTaskID :exec
DELETE FROM task_completions
WHERE task_id = $1;
