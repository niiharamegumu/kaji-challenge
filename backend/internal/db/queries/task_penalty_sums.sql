-- name: SumDailyPenaltyForClose :one
SELECT COALESCE(SUM(t.penalty_points), 0)::bigint AS total_penalty
FROM tasks t
LEFT JOIN task_completion_daily d
  ON d.task_id = t.id
 AND d.target_date = $2
WHERE t.team_id = $1
  AND t.type = 'daily'
  AND t.created_at < $3
  AND (t.deleted_at IS NULL OR t.deleted_at >= $3)
  AND d.task_id IS NULL;

-- name: SumDailyPenaltyForDate :one
SELECT COALESCE(SUM(t.penalty_points), 0)::bigint AS total_penalty
FROM tasks t
LEFT JOIN task_completion_daily d
  ON d.task_id = t.id
 AND d.target_date = $2
WHERE t.team_id = $1
  AND t.type = 'daily'
  AND t.created_at < $3
  AND (t.deleted_at IS NULL OR t.deleted_at >= $3)
  AND d.task_id IS NULL;

-- name: SumWeeklyPenaltyForClose :one
SELECT COALESCE(SUM(t.penalty_points), 0)::bigint AS total_penalty
FROM tasks t
LEFT JOIN (
  SELECT task_id, week_start, COUNT(*)::integer AS completion_count
  FROM task_completion_weekly_entries
  WHERE week_start = $2
  GROUP BY task_id, week_start
) w
  ON w.task_id = t.id
 AND w.week_start = $2
WHERE t.team_id = $1
  AND t.type = 'weekly'
  AND t.created_at < $3
  AND (t.deleted_at IS NULL OR t.deleted_at >= $3)
  AND COALESCE(w.completion_count, 0) < t.required_completions_per_week;

-- name: SumWeeklyPenaltyForWeek :one
SELECT COALESCE(SUM(t.penalty_points), 0)::bigint AS total_penalty
FROM tasks t
LEFT JOIN (
  SELECT task_id, week_start, COUNT(*)::integer AS completion_count
  FROM task_completion_weekly_entries
  WHERE week_start = $2
  GROUP BY task_id, week_start
) w
  ON w.task_id = t.id
 AND w.week_start = $2
WHERE t.team_id = $1
  AND t.type = 'weekly'
  AND t.created_at < $3
  AND (t.deleted_at IS NULL OR t.deleted_at >= $3)
  AND COALESCE(w.completion_count, 0) < t.required_completions_per_week;

-- name: SumDailyPenaltyForMonth :one
SELECT COALESCE(SUM(t.penalty_points), 0)::bigint AS total_penalty
FROM close_runs r
JOIN tasks t
  ON t.team_id = r.team_id
 AND t.type = 'daily'
 AND t.created_at < (((r.target_date + 1)::date)::timestamp AT TIME ZONE 'Asia/Tokyo')
 AND (t.deleted_at IS NULL OR t.deleted_at >= (((r.target_date + 1)::date)::timestamp AT TIME ZONE 'Asia/Tokyo'))
LEFT JOIN task_completion_daily d
  ON d.task_id = t.id
 AND d.target_date = r.target_date
WHERE r.team_id = $1
  AND r.scope = 'close_day'
  AND r.target_date >= $2
  AND r.target_date < $3
  AND d.task_id IS NULL;

-- name: SumWeeklyPenaltyForMonth :one
SELECT COALESCE(SUM(t.penalty_points), 0)::bigint AS total_penalty
FROM close_runs r
JOIN tasks t
  ON t.team_id = r.team_id
 AND t.type = 'weekly'
 AND t.created_at < (((r.target_date + 7)::date)::timestamp AT TIME ZONE 'Asia/Tokyo')
 AND (t.deleted_at IS NULL OR t.deleted_at >= (((r.target_date + 7)::date)::timestamp AT TIME ZONE 'Asia/Tokyo'))
LEFT JOIN LATERAL (
  SELECT COUNT(*)::integer AS completion_count
  FROM task_completion_weekly_entries e
  WHERE e.task_id = t.id
    AND e.week_start = r.target_date
) w ON TRUE
WHERE r.team_id = $1
  AND r.scope = 'close_week'
  AND (r.target_date + 6) >= $2
  AND (r.target_date + 6) < $3
  AND COALESCE(w.completion_count, 0) < t.required_completions_per_week;
