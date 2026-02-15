-- name: GetMonthlyPenaltySummary :one
SELECT team_id, month, daily_penalty_total, weekly_penalty_total, is_closed, triggered_penalty_rule_ids
FROM monthly_penalty_summaries
WHERE team_id = $1 AND month = $2;

-- name: UpsertMonthlyPenaltySummary :exec
INSERT INTO monthly_penalty_summaries (team_id, month, daily_penalty_total, weekly_penalty_total, is_closed, triggered_penalty_rule_ids)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (team_id, month) DO UPDATE SET
  daily_penalty_total = EXCLUDED.daily_penalty_total,
  weekly_penalty_total = EXCLUDED.weekly_penalty_total,
  is_closed = EXCLUDED.is_closed,
  triggered_penalty_rule_ids = EXCLUDED.triggered_penalty_rule_ids;

-- name: IncrementDailyPenalty :exec
UPDATE monthly_penalty_summaries
SET daily_penalty_total = daily_penalty_total + $3
WHERE team_id = $1 AND month = $2;

-- name: IncrementWeeklyPenalty :exec
UPDATE monthly_penalty_summaries
SET weekly_penalty_total = weekly_penalty_total + $3
WHERE team_id = $1 AND month = $2;

-- name: CloseMonthlyPenaltySummary :exec
UPDATE monthly_penalty_summaries
SET is_closed = TRUE,
    triggered_penalty_rule_ids = $3
WHERE team_id = $1 AND month = $2;
