-- name: CreateTaskCompletionDaily :exec
INSERT INTO task_completion_daily (task_id, target_date, created_at)
VALUES ($1, $2, NOW())
ON CONFLICT (task_id, target_date) DO NOTHING;

-- name: DeleteTaskCompletionDaily :exec
DELETE FROM task_completion_daily
WHERE task_id = $1 AND target_date = $2;

-- name: HasTaskCompletionDaily :one
SELECT EXISTS (
  SELECT 1
  FROM task_completion_daily
  WHERE task_id = $1 AND target_date = $2
);

-- name: ListCompletedDailyTaskIDsByTeamAndDate :many
SELECT d.task_id
FROM task_completion_daily d
JOIN tasks t ON t.id = d.task_id
WHERE t.team_id = $1
  AND t.type = 'daily'
  AND d.target_date = $2
ORDER BY d.task_id;

-- name: DeleteTaskCompletionDailyByTaskID :exec
DELETE FROM task_completion_daily
WHERE task_id = $1;

-- name: GetTaskCompletionWeeklyCount :one
SELECT COALESCE((
  SELECT completion_count
  FROM task_completion_weekly
  WHERE task_id = $1 AND week_start = $2
), 0)::bigint;

-- name: ListTaskCompletionWeeklyCountsByTeamAndWeek :many
SELECT w.task_id, w.completion_count
FROM task_completion_weekly w
JOIN tasks t ON t.id = w.task_id
WHERE t.team_id = $1
  AND t.type = 'weekly'
  AND w.week_start = $2
ORDER BY w.task_id;

-- name: IncrementTaskCompletionWeekly :one
INSERT INTO task_completion_weekly (task_id, week_start, completion_count, created_at, updated_at)
VALUES ($1, $2, 1, NOW(), NOW())
ON CONFLICT (task_id, week_start) DO UPDATE
SET completion_count = LEAST(sqlc.arg(max_completion)::integer, task_completion_weekly.completion_count + 1),
    updated_at = NOW()
RETURNING completion_count::bigint;

-- name: DecrementTaskCompletionWeekly :one
INSERT INTO task_completion_weekly (task_id, week_start, completion_count, created_at, updated_at)
VALUES ($1, $2, 0, NOW(), NOW())
ON CONFLICT (task_id, week_start) DO UPDATE
SET completion_count = GREATEST(0, task_completion_weekly.completion_count - 1),
    updated_at = NOW()
RETURNING completion_count::bigint;

-- name: ToggleTaskCompletionWeeklyBinary :one
INSERT INTO task_completion_weekly (task_id, week_start, completion_count, created_at, updated_at)
VALUES ($1, $2, 1, NOW(), NOW())
ON CONFLICT (task_id, week_start) DO UPDATE
SET completion_count = CASE
  WHEN task_completion_weekly.completion_count > 0 THEN 0
  ELSE 1
END,
    updated_at = NOW()
RETURNING completion_count::bigint;

-- name: UpsertTaskCompletionWeeklyCount :exec
INSERT INTO task_completion_weekly (task_id, week_start, completion_count, created_at, updated_at)
VALUES ($1, $2, $3, NOW(), NOW())
ON CONFLICT (task_id, week_start) DO UPDATE
SET completion_count = EXCLUDED.completion_count,
    updated_at = NOW();

-- name: DeleteTaskCompletionWeekly :exec
DELETE FROM task_completion_weekly
WHERE task_id = $1 AND week_start = $2;

-- name: DeleteTaskCompletionWeeklyIfZero :exec
DELETE FROM task_completion_weekly
WHERE task_id = $1 AND week_start = $2 AND completion_count = 0;

-- name: DeleteTaskCompletionWeeklyByTaskID :exec
DELETE FROM task_completion_weekly
WHERE task_id = $1;

-- name: ListTaskCompletionDailyByMonthAndTeam :many
SELECT d.task_id, d.target_date
FROM task_completion_daily d
JOIN tasks t ON t.id = d.task_id
WHERE t.team_id = $1
  AND d.target_date >= $2
  AND d.target_date < $3
ORDER BY d.target_date, d.task_id;

-- name: ListTaskCompletionWeeklyByMonthAndTeam :many
SELECT w.task_id, w.week_start, w.completion_count
FROM task_completion_weekly w
JOIN tasks t ON t.id = w.task_id
WHERE t.team_id = $1
  AND w.week_start >= $2
  AND w.week_start < $3
ORDER BY w.week_start, w.task_id;
