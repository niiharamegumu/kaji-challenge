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

-- name: IncrementWeeklyPenalty :exec
UPDATE monthly_penalty_summaries
SET weekly_penalty_total = weekly_penalty_total + $3
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
