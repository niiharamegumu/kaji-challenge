-- name: CreateTaskCompletionDaily :exec
INSERT INTO task_completion_daily (task_id, target_date, completed_by_user_id, created_at)
VALUES ($1, $2, NULLIF(sqlc.arg(completed_by_user_id), '')::uuid, NOW())
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

-- name: ListTaskCompletionDailyByTeamAndDate :many
SELECT
  d.task_id,
  COALESCE(d.completed_by_user_id::text, ''::text) AS completed_by_user_id,
  COALESCE(NULLIF(u.nickname, ''), u.display_name, ''::text) AS completed_by_effective_name
FROM task_completion_daily d
JOIN tasks t ON t.id = d.task_id
LEFT JOIN users u ON u.id = d.completed_by_user_id
WHERE t.team_id = $1
  AND t.type = 'daily'
  AND d.target_date = $2
ORDER BY d.task_id;

-- name: DeleteTaskCompletionDailyByTaskID :exec
DELETE FROM task_completion_daily
WHERE task_id = $1;

-- name: GetTaskCompletionWeeklyEntryCount :one
SELECT COALESCE((
  SELECT COUNT(*)::integer
  FROM task_completion_weekly_entries
  WHERE task_id = $1 AND week_start = $2
), 0)::bigint;

-- name: ListTaskCompletionWeeklyCountsByTeamAndWeek :many
SELECT e.task_id, COUNT(*)::integer AS completion_count
FROM task_completion_weekly_entries e
JOIN tasks t ON t.id = e.task_id
WHERE t.team_id = $1
  AND t.type = 'weekly'
  AND e.week_start = $2
GROUP BY e.task_id
ORDER BY e.task_id;

-- name: InsertTaskCompletionWeeklyEntry :exec
INSERT INTO task_completion_weekly_entries (id, task_id, week_start, completed_by_user_id, created_at)
VALUES ($1, $2, $3, NULLIF(sqlc.arg(completed_by_user_id), '')::uuid, NOW());

-- name: DeleteLatestTaskCompletionWeeklyEntry :execrows
WITH latest AS (
  SELECT id
  FROM task_completion_weekly_entries e
  WHERE e.task_id = $1
    AND e.week_start = $2
  ORDER BY created_at DESC, id DESC
  LIMIT 1
)
DELETE FROM task_completion_weekly_entries e
USING latest
WHERE e.id = latest.id;

-- name: DeleteTaskCompletionWeeklyEntriesByTaskID :exec
DELETE FROM task_completion_weekly_entries
WHERE task_id = $1;

-- name: ListTaskCompletionDailyByMonthAndTeam :many
SELECT
  d.task_id,
  d.target_date,
  COALESCE(d.completed_by_user_id::text, ''::text) AS completed_by_user_id,
  COALESCE(NULLIF(u.nickname, ''), u.display_name, ''::text) AS completed_by_effective_name
FROM task_completion_daily d
JOIN tasks t ON t.id = d.task_id
LEFT JOIN users u ON u.id = d.completed_by_user_id
WHERE t.team_id = $1
  AND d.target_date >= $2
  AND d.target_date < $3
ORDER BY d.target_date, d.task_id;

-- name: ListTaskCompletionWeeklyByMonthAndTeam :many
SELECT e.task_id, e.week_start, COUNT(*)::integer AS completion_count
FROM task_completion_weekly_entries e
JOIN tasks t ON t.id = e.task_id
WHERE t.team_id = $1
  AND e.week_start >= $2
  AND e.week_start < $3
GROUP BY e.task_id, e.week_start
ORDER BY e.week_start, e.task_id;

-- name: ListTaskCompletionWeeklySlotsByTeamAndWeek :many
SELECT
  e.task_id,
  ROW_NUMBER() OVER (PARTITION BY e.task_id ORDER BY e.created_at ASC, e.id ASC)::integer AS slot,
  COALESCE(e.completed_by_user_id::text, ''::text) AS completed_by_user_id,
  COALESCE(NULLIF(u.nickname, ''), u.display_name, ''::text) AS completed_by_effective_name
FROM task_completion_weekly_entries e
JOIN tasks t ON t.id = e.task_id
LEFT JOIN users u ON u.id = e.completed_by_user_id
WHERE t.team_id = $1
  AND t.type = 'weekly'
  AND e.week_start = $2
ORDER BY e.task_id, slot;

-- name: ListTaskCompletionWeeklySlotsByMonthAndTeam :many
SELECT
  e.task_id,
  e.week_start,
  ROW_NUMBER() OVER (PARTITION BY e.task_id, e.week_start ORDER BY e.created_at ASC, e.id ASC)::integer AS slot,
  COALESCE(e.completed_by_user_id::text, ''::text) AS completed_by_user_id,
  COALESCE(NULLIF(u.nickname, ''), u.display_name, ''::text) AS completed_by_effective_name
FROM task_completion_weekly_entries e
JOIN tasks t ON t.id = e.task_id
LEFT JOIN users u ON u.id = e.completed_by_user_id
WHERE t.team_id = $1
  AND t.type = 'weekly'
  AND e.week_start >= $2
  AND e.week_start < $3
ORDER BY e.week_start, e.task_id, slot;
