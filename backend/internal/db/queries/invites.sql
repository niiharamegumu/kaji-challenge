-- name: CreateInviteCode :exec
INSERT INTO invite_codes (code, team_id, expires_at, created_at)
VALUES ($1, $2, $3, NOW());

-- name: DeleteInviteCodesByTeamID :exec
DELETE FROM invite_codes
WHERE team_id = $1;

-- name: DeleteInviteCode :execrows
DELETE FROM invite_codes
WHERE code = $1;

-- name: GetInviteCode :one
SELECT code, team_id, expires_at, created_at
FROM invite_codes
WHERE code = $1;

-- name: GetLatestInviteCodeByTeamID :one
SELECT code, team_id, expires_at, created_at
FROM invite_codes
WHERE team_id = $1
ORDER BY created_at DESC
LIMIT 1;
