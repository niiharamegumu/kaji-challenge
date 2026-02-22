-- name: ListPenaltyRulesByTeamID :many
SELECT id, team_id, threshold, name, description, deleted_at, created_at, updated_at
FROM penalty_rules
WHERE team_id = $1
ORDER BY threshold;

-- name: ListUndeletedPenaltyRulesByTeamID :many
SELECT id, team_id, threshold, name, description, deleted_at, created_at, updated_at
FROM penalty_rules
WHERE team_id = $1 AND deleted_at IS NULL
ORDER BY threshold;

-- name: ListPenaltyRulesEffectiveAtByTeamID :many
SELECT id, team_id, threshold, name, description, deleted_at, created_at, updated_at
FROM penalty_rules
WHERE team_id = $1
  AND created_at < sqlc.arg(as_of)
  AND (deleted_at IS NULL OR deleted_at >= sqlc.arg(as_of))
ORDER BY threshold;

-- name: GetPenaltyRuleByID :one
SELECT id, team_id, threshold, name, description, deleted_at, created_at, updated_at
FROM penalty_rules
WHERE id = $1;

-- name: GetUndeletedPenaltyRuleByID :one
SELECT id, team_id, threshold, name, description, deleted_at, created_at, updated_at
FROM penalty_rules
WHERE id = $1 AND deleted_at IS NULL;

-- name: CreatePenaltyRule :exec
INSERT INTO penalty_rules (id, team_id, threshold, name, description, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: UpdatePenaltyRule :exec
UPDATE penalty_rules
SET threshold = $2,
    name = $3,
    description = $4,
    updated_at = $5
WHERE id = $1 AND deleted_at IS NULL;

-- name: SoftDeletePenaltyRule :execrows
UPDATE penalty_rules
SET deleted_at = $2,
    updated_at = $2
WHERE id = $1 AND deleted_at IS NULL;
