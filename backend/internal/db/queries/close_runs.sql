-- name: InsertCloseRun :execrows
INSERT INTO close_runs (team_id, scope, target_date, created_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (team_id, scope, target_date) DO NOTHING;

-- name: GetLatestCloseRunTargetDate :one
SELECT MAX(target_date)::date AS target_date
FROM close_runs
WHERE team_id = $1
  AND scope = $2;

-- name: ListCloseRunTargetDatesInRange :many
SELECT target_date
FROM close_runs
WHERE team_id = $1
  AND scope = $2
  AND target_date >= $3
  AND target_date < $4
ORDER BY target_date;

-- name: InsertDayCloseRunsForMonth :exec
INSERT INTO close_runs (team_id, scope, target_date, created_at)
SELECT sqlc.arg(team_id), 'close_day', day::date, NOW()
FROM generate_series(sqlc.arg(month_start)::date, sqlc.arg(month_end)::date - 1, INTERVAL '1 day') AS day
ON CONFLICT (team_id, scope, target_date) DO NOTHING;

-- name: InsertWeekCloseRunsForMonth :exec
INSERT INTO close_runs (team_id, scope, target_date, created_at)
SELECT sqlc.arg(team_id), 'close_week', week_start::date, NOW()
FROM generate_series(sqlc.arg(first_week_start)::date, sqlc.arg(month_end)::date - 1, INTERVAL '7 days') AS week_start
WHERE (week_start::date + 6) >= sqlc.arg(month_start)::date
  AND (week_start::date + 6) < sqlc.arg(month_end)::date
ON CONFLICT (team_id, scope, target_date) DO NOTHING;
