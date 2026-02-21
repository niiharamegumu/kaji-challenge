-- name: InsertCloseRun :execrows
INSERT INTO close_runs (team_id, scope, target_date, created_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (team_id, scope, target_date) DO NOTHING;

-- name: GetLatestCloseRunTargetDate :one
SELECT MAX(target_date)::date AS target_date
FROM close_runs
WHERE team_id = $1
  AND scope = $2;
