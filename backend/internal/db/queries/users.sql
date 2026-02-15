-- name: GetUserByEmail :one
SELECT id, email, display_name, created_at
FROM users
WHERE email = $1;

-- name: GetUserByID :one
SELECT id, email, display_name, created_at
FROM users
WHERE id = $1;

-- name: CreateUser :exec
INSERT INTO users (id, email, display_name, created_at)
VALUES ($1, $2, $3, $4);

-- name: UpdateUserDisplayName :exec
UPDATE users
SET display_name = $2
WHERE id = $1;
