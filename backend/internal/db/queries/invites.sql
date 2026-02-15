-- name: CreateInviteCode :exec
INSERT INTO invite_codes (code, team_id, expires_at, max_uses, used_count, created_at)
VALUES ($1, $2, $3, $4, $5, NOW());

-- name: GetInviteCode :one
SELECT code, team_id, expires_at, max_uses, used_count, created_at
FROM invite_codes
WHERE code = $1;

-- name: IncrementInviteCodeUsedCount :execrows
UPDATE invite_codes
SET used_count = used_count + 1
WHERE code = $1 AND used_count < max_uses;
