-- name: InsertTaskEvaluationDedupe :execrows
INSERT INTO task_evaluation_dedupes (team_id, scope, target_date, task_id, created_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (team_id, scope, target_date, task_id) DO NOTHING;

-- name: SumDailyPenaltyForClose :one
WITH candidates AS (
  SELECT t.id AS task_id, t.penalty_points
  FROM tasks t
  LEFT JOIN task_completion_daily d
    ON d.task_id = t.id
   AND d.target_date = $2
  WHERE t.team_id = $1
    AND t.type = 'daily'
    AND t.created_at < $3
    AND (t.deleted_at IS NULL OR t.deleted_at >= $3)
    AND d.task_id IS NULL
),
deduped AS (
  INSERT INTO task_evaluation_dedupes (team_id, scope, target_date, task_id, created_at)
  SELECT $1, 'penalty_day', $2, c.task_id, NOW()
  FROM candidates c
  ON CONFLICT (team_id, scope, target_date, task_id) DO NOTHING
  RETURNING task_id
)
SELECT COALESCE(SUM(c.penalty_points), 0)::bigint AS total_penalty
FROM candidates c
JOIN deduped d ON d.task_id = c.task_id;

-- name: SumWeeklyPenaltyForClose :one
WITH candidates AS (
  SELECT t.id AS task_id, t.penalty_points
  FROM tasks t
  LEFT JOIN task_completion_weekly w
    ON w.task_id = t.id
   AND w.week_start = $2
  WHERE t.team_id = $1
    AND t.type = 'weekly'
    AND t.created_at < $3
    AND (t.deleted_at IS NULL OR t.deleted_at >= $3)
    AND COALESCE(w.completion_count, 0) < t.required_completions_per_week
),
deduped AS (
  INSERT INTO task_evaluation_dedupes (team_id, scope, target_date, task_id, created_at)
  SELECT $1, 'penalty_week', $2, c.task_id, NOW()
  FROM candidates c
  ON CONFLICT (team_id, scope, target_date, task_id) DO NOTHING
  RETURNING task_id
)
SELECT COALESCE(SUM(c.penalty_points), 0)::bigint AS total_penalty
FROM candidates c
JOIN deduped d ON d.task_id = c.task_id;
