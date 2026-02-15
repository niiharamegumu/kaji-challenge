-- name: ListTasksByTeamID :many
SELECT id, team_id, title, notes, type, penalty_points, COALESCE(assignee_user_id::text, '') AS assignee_user_id, is_active, required_completions_per_week, created_at, updated_at
FROM tasks
WHERE team_id = $1
ORDER BY created_at;

-- name: ListActiveTasksByTeamID :many
SELECT id, team_id, title, notes, type, penalty_points, COALESCE(assignee_user_id::text, '') AS assignee_user_id, is_active, required_completions_per_week, created_at, updated_at
FROM tasks
WHERE team_id = $1 AND is_active = TRUE
ORDER BY created_at;

-- name: GetTaskByID :one
SELECT id, team_id, title, notes, type, penalty_points, COALESCE(assignee_user_id::text, '') AS assignee_user_id, is_active, required_completions_per_week, created_at, updated_at
FROM tasks
WHERE id = $1;

-- name: CreateTask :exec
INSERT INTO tasks (id, team_id, title, notes, type, penalty_points, assignee_user_id, is_active, required_completions_per_week, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, '')::uuid, $8, $9, $10, $11);

-- name: UpdateTask :exec
UPDATE tasks
SET title = $2,
    notes = $3,
    penalty_points = $4,
    assignee_user_id = NULLIF($5, '')::uuid,
    is_active = $6,
    required_completions_per_week = $7,
    updated_at = $8
WHERE id = $1;

-- name: DeleteTask :exec
DELETE FROM tasks
WHERE id = $1;
