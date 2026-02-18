-- name: InsertAuthRequest :exec
INSERT INTO oauth_auth_requests (state, nonce, code_verifier, expires_at, created_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (state) DO UPDATE SET
  nonce = EXCLUDED.nonce,
  code_verifier = EXCLUDED.code_verifier,
  expires_at = EXCLUDED.expires_at;

-- name: GetAuthRequest :one
SELECT state, nonce, code_verifier, expires_at, created_at
FROM oauth_auth_requests
WHERE state = $1;

-- name: DeleteAuthRequest :exec
DELETE FROM oauth_auth_requests
WHERE state = $1;

-- name: InsertExchangeCode :exec
INSERT INTO oauth_exchange_codes (code, user_id, expires_at, used_at, created_at)
VALUES ($1, $2, $3, NULL, NOW())
ON CONFLICT (code) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  expires_at = EXCLUDED.expires_at,
  used_at = NULL;

-- name: GetExchangeCode :one
SELECT code, user_id, expires_at, used_at, created_at
FROM oauth_exchange_codes
WHERE code = $1;

-- name: ConsumeExchangeCode :exec
UPDATE oauth_exchange_codes
SET used_at = NOW()
WHERE code = $1 AND used_at IS NULL;

-- name: CreateSession :exec
INSERT INTO sessions (token, user_id, created_at, expires_at)
VALUES ($1, $2, NOW(), NULL);

-- name: GetSessionByToken :one
SELECT s.token, s.user_id, s.created_at, s.expires_at
FROM sessions AS s
INNER JOIN users AS u ON u.id = s.user_id
WHERE s.token = $1
  AND (s.expires_at IS NULL OR s.expires_at > NOW());

-- name: DeleteSession :exec
DELETE FROM sessions
WHERE token = $1;
