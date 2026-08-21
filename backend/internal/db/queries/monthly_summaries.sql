-- name: GetMonthlyPenaltySummary :one
SELECT team_id, month_start, daily_penalty_total, weekly_penalty_total, is_closed
FROM monthly_penalty_summaries
WHERE team_id = $1 AND month_start = $2;

-- name: UpsertMonthlyPenaltySummary :exec
INSERT INTO monthly_penalty_summaries (team_id, month_start, daily_penalty_total, weekly_penalty_total, is_closed)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (team_id, month_start) DO UPDATE SET
  daily_penalty_total = EXCLUDED.daily_penalty_total,
  weekly_penalty_total = EXCLUDED.weekly_penalty_total,
  is_closed = EXCLUDED.is_closed;

-- name: IncrementDailyPenalty :exec
UPDATE monthly_penalty_summaries
SET daily_penalty_total = daily_penalty_total + $3
WHERE team_id = $1 AND month_start = $2;

-- name: SetDailyPenaltyTotal :exec
UPDATE monthly_penalty_summaries
SET daily_penalty_total = $3
WHERE team_id = $1 AND month_start = $2;

-- name: IncrementWeeklyPenalty :exec
UPDATE monthly_penalty_summaries
SET weekly_penalty_total = weekly_penalty_total + $3
WHERE team_id = $1 AND month_start = $2;

-- name: SetWeeklyPenaltyTotal :exec
UPDATE monthly_penalty_summaries
SET weekly_penalty_total = $3
WHERE team_id = $1 AND month_start = $2;

-- name: CloseMonthlyPenaltySummary :exec
UPDATE monthly_penalty_summaries
SET is_closed = TRUE
WHERE team_id = $1 AND month_start = $2;

-- name: DeleteTriggeredRulesByMonth :exec
DELETE FROM monthly_penalty_summary_triggered_rules
WHERE team_id = $1 AND month_start = $2;

-- name: AddTriggeredRuleForMonth :exec
INSERT INTO monthly_penalty_summary_triggered_rules (team_id, month_start, rule_id, created_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (team_id, month_start, rule_id) DO NOTHING;

-- name: ListTriggeredRuleIDsByMonth :many
SELECT rule_id
FROM monthly_penalty_summary_triggered_rules
WHERE team_id = $1 AND month_start = $2
ORDER BY rule_id;

-- name: FindOldestMonthCloseCandidate :one
WITH bounds AS (
  SELECT date_trunc('month', MIN(t.created_at AT TIME ZONE 'Asia/Tokyo'))::date AS first_month
  FROM tasks t
  WHERE t.team_id = sqlc.arg(team_id)
), months AS (
  SELECT month_start::date
  FROM bounds b
  CROSS JOIN LATERAL generate_series(
    b.first_month,
    sqlc.arg(current_month_start)::date - INTERVAL '1 month',
    INTERVAL '1 month'
  ) AS month_start
  WHERE b.first_month IS NOT NULL
), eligible AS (
  SELECT m.month_start
  FROM months m
  WHERE EXISTS (
    SELECT 1
    FROM tasks t
    WHERE t.team_id = sqlc.arg(team_id)
      AND t.created_at < ((m.month_start + INTERVAL '1 month')::timestamp AT TIME ZONE 'Asia/Tokyo')
      AND (t.deleted_at IS NULL OR t.deleted_at >= (m.month_start::timestamp AT TIME ZONE 'Asia/Tokyo'))
  )
    AND NOT EXISTS (
      SELECT 1
      FROM monthly_penalty_summaries s
      WHERE s.team_id = sqlc.arg(team_id)
        AND s.month_start = m.month_start
        AND s.is_closed = TRUE
    )
)
SELECT month_start, COUNT(*) OVER ()::integer AS pending_month_count
FROM eligible
ORDER BY month_start
LIMIT 1;

-- name: GetMonthCloseState :one
SELECT is_closed
FROM monthly_penalty_summaries
WHERE team_id = $1 AND month_start = $2;

-- name: SetMonthPenaltyTotals :exec
UPDATE monthly_penalty_summaries
SET daily_penalty_total = $3,
    weekly_penalty_total = $4
WHERE team_id = $1 AND month_start = $2;
