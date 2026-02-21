-- name: InsertCloseRun :execrows
INSERT INTO close_runs (team_id, scope, target_date, created_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (team_id, scope, target_date) DO NOTHING;
