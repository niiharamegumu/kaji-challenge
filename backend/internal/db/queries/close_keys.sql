-- name: InsertCloseExecution :execrows
INSERT INTO close_executions (team_id, scope, target_date, task_id, created_at)
VALUES ($1, $2, $3, NULLIF($4, '')::uuid, NOW())
ON CONFLICT (team_id, scope, target_date, dedupe_task_key) DO NOTHING;
