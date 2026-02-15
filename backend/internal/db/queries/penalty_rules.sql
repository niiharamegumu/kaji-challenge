-- name: ListPenaltyRulesByTeamID :many
SELECT id, team_id, threshold, name, description, is_active, created_at, updated_at
FROM penalty_rules
WHERE team_id = $1
ORDER BY threshold;

-- name: ListActivePenaltyRulesByTeamID :many
SELECT id, team_id, threshold, name, description, is_active, created_at, updated_at
FROM penalty_rules
WHERE team_id = $1 AND is_active = TRUE
ORDER BY threshold;

-- name: GetPenaltyRuleByID :one
SELECT id, team_id, threshold, name, description, is_active, created_at, updated_at
FROM penalty_rules
WHERE id = $1;

-- name: CreatePenaltyRule :exec
INSERT INTO penalty_rules (id, team_id, threshold, name, description, is_active, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: UpdatePenaltyRule :exec
UPDATE penalty_rules
SET threshold = $2,
    name = $3,
    description = $4,
    is_active = $5,
    updated_at = $6
WHERE id = $1;

-- name: DeletePenaltyRule :exec
DELETE FROM penalty_rules
WHERE id = $1;
