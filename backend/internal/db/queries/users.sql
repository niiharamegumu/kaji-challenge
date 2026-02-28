-- name: GetUserByEmail :one
SELECT id, email, display_name, COALESCE(nickname, '') AS nickname, color_hex, created_at
FROM users
WHERE LOWER(email) = LOWER($1);

-- name: GetUserByID :one
SELECT id, email, display_name, COALESCE(nickname, '') AS nickname, color_hex, created_at
FROM users
WHERE id = $1;

-- name: CreateUser :exec
INSERT INTO users (id, email, display_name, created_at)
VALUES ($1, $2, $3, $4);

-- name: UpdateUserDisplayName :exec
UPDATE users
SET display_name = $2
WHERE id = $1;

-- name: UpdateUserNickname :exec
UPDATE users
SET nickname = NULLIF($2, '')
WHERE id = $1;

-- name: UpdateUserColorHex :exec
UPDATE users
SET color_hex = NULLIF($2, '')
WHERE id = $1;

-- name: GetUserAuthIdentityByID :one
SELECT id,
       COALESCE(oidc_issuer, '') AS oidc_issuer,
       COALESCE(oidc_subject, '') AS oidc_subject
FROM users
WHERE id = $1;

-- name: UpdateUserOIDCByID :exec
UPDATE users
SET oidc_issuer = NULLIF($2, ''),
    oidc_subject = NULLIF($3, ''),
    oidc_linked_at = $4
WHERE id = $1;
