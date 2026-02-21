-- name: InsertTaskEvaluationDedupe :execrows
INSERT INTO task_evaluation_dedupes (team_id, scope, target_date, task_id, created_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (team_id, scope, target_date, task_id) DO NOTHING;
