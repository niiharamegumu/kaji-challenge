-- name: ListTasksByTeamID :many
SELECT id, team_id, title, notes, type, penalty_points, COALESCE(assignee_user_id::text, '') AS assignee_user_id, required_completions_per_week, created_at, updated_at, deleted_at
FROM tasks
WHERE team_id = $1
  AND deleted_at IS NULL
ORDER BY created_at;

-- name: ListUndeletedTasksByTeamID :many
SELECT id, team_id, title, notes, type, penalty_points, COALESCE(assignee_user_id::text, '') AS assignee_user_id, required_completions_per_week, created_at, updated_at, deleted_at
FROM tasks
WHERE team_id = $1
  AND deleted_at IS NULL
ORDER BY created_at;

-- name: GetEarliestTaskCreatedAtByTeam :one
SELECT MIN(created_at)::timestamptz AS created_at
FROM tasks
WHERE team_id = $1;

-- name: ListTasksEffectiveForCloseByTeamAndType :many
SELECT id, team_id, title, notes, type, penalty_points, COALESCE(assignee_user_id::text, '') AS assignee_user_id, required_completions_per_week, created_at, updated_at, deleted_at
FROM tasks
WHERE team_id = $1
  AND type = $2
  AND created_at < $3
  AND (deleted_at IS NULL OR deleted_at >= $3)
ORDER BY created_at;

-- name: GetTaskByID :one
SELECT id, team_id, title, notes, type, penalty_points, COALESCE(assignee_user_id::text, '') AS assignee_user_id, required_completions_per_week, created_at, updated_at, deleted_at
FROM tasks
WHERE id = $1;

-- name: CreateTask :exec
INSERT INTO tasks (id, team_id, title, notes, type, penalty_points, assignee_user_id, required_completions_per_week, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, '')::uuid, $8, $9, $10);

-- name: UpdateTask :exec
UPDATE tasks
SET title = $2,
    notes = $3,
    penalty_points = $4,
    assignee_user_id = NULLIF($5, '')::uuid,
    required_completions_per_week = $6,
    updated_at = $7
WHERE id = $1;

-- name: DeleteTask :exec
UPDATE tasks
SET deleted_at = NOW(),
    updated_at = NOW()
WHERE id = $1;

-- name: ClearTaskAssigneeByTeamAndUser :exec
UPDATE tasks
SET assignee_user_id = NULL
WHERE team_id = $1
  AND assignee_user_id = NULLIF($2, '')::uuid
  AND deleted_at IS NULL;

-- name: ListTasksForMonthlyStatusByTeam :many
SELECT id, title, type, penalty_points, created_at, deleted_at
FROM tasks
WHERE team_id = $1
  AND created_at < $3
  AND deleted_at IS NULL
UNION ALL
SELECT id, title, type, penalty_points, created_at, deleted_at
FROM tasks
WHERE team_id = $1
  AND created_at < $3
  AND deleted_at >= $2
ORDER BY created_at, id;
