-- name: CreateInviteCode :exec
INSERT INTO invite_codes (code, team_id, expires_at, max_uses, used_count, created_at)
VALUES ($1, $2, $3, $4, $5, NOW());

-- name: DeleteInviteCodesByTeamID :exec
DELETE FROM invite_codes
WHERE team_id = $1;

-- name: DeleteInviteCode :execrows
DELETE FROM invite_codes
WHERE code = $1;

-- name: GetInviteCode :one
SELECT code, team_id, expires_at, max_uses, used_count, created_at
FROM invite_codes
WHERE code = $1;
