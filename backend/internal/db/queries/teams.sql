-- name: CreateTeam :exec
INSERT INTO teams (id, created_at)
VALUES ($1, $2);

-- name: AddTeamMember :exec
INSERT INTO team_members (team_id, user_id, role, created_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (team_id, user_id) DO NOTHING;

-- name: ListMembershipsByUserID :many
SELECT team_id, role
FROM team_members
WHERE user_id = $1;
