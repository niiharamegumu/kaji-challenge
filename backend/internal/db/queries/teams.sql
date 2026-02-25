-- name: CreateTeam :exec
INSERT INTO teams (id, name, created_at)
VALUES ($1, $2, $3);

-- name: DeleteTeam :exec
DELETE FROM teams
WHERE id = $1;

-- name: UpdateTeamName :exec
UPDATE teams
SET name = $2
WHERE id = $1;

-- name: AddTeamMember :exec
INSERT INTO team_members (team_id, user_id, role, created_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (team_id, user_id) DO NOTHING;

-- name: DeleteTeamMember :exec
DELETE FROM team_members
WHERE team_id = $1
  AND user_id = $2;

-- name: UpdateTeamMemberRole :exec
UPDATE team_members
SET role = $3
WHERE team_id = $1
  AND user_id = $2;

-- name: GetOldestOtherTeamMember :one
SELECT user_id
FROM team_members
WHERE team_id = $1
  AND user_id <> $2
ORDER BY created_at ASC
LIMIT 1;

-- name: ListMembershipsByUserID :many
SELECT tm.team_id, tm.role, t.name AS team_name
FROM team_members tm
INNER JOIN teams t ON t.id = tm.team_id
WHERE tm.user_id = $1;

-- name: ListTeamMembersByTeamID :many
SELECT
  tm.team_id,
  tm.user_id,
  tm.role,
  tm.created_at,
  u.display_name,
  COALESCE(u.nickname, '') AS nickname
FROM team_members tm
INNER JOIN users u ON u.id = tm.user_id
WHERE tm.team_id = $1
ORDER BY tm.created_at ASC;

-- name: ListTeamIDsForClose :many
SELECT t.id
FROM teams t
WHERE EXISTS (
  SELECT 1
  FROM team_members tm
  WHERE tm.team_id = t.id
)
ORDER BY t.created_at ASC, t.id ASC;

-- name: GetTeamStateRevision :one
SELECT state_revision
FROM teams
WHERE id = $1;

-- name: IncrementTeamStateRevision :one
UPDATE teams
SET state_revision = state_revision + 1
WHERE id = $1
RETURNING state_revision;
