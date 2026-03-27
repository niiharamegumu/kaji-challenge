-- name: ListRemindersByTeamID :many
SELECT id, team_id, title, notes, kind, schedule_type, start_date, end_date, created_at, updated_at
FROM reminders
WHERE team_id = $1
ORDER BY created_at ASC, id ASC;

-- name: GetReminderByID :one
SELECT id, team_id, title, notes, kind, schedule_type, start_date, end_date, created_at, updated_at
FROM reminders
WHERE id = $1;

-- name: CreateReminder :exec
INSERT INTO reminders (id, team_id, title, notes, kind, schedule_type, start_date, end_date, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- name: UpdateReminder :exec
UPDATE reminders
SET title = $2,
    notes = $3,
    kind = $4,
    schedule_type = $5,
    start_date = $6,
    end_date = $7,
    updated_at = $8
WHERE id = $1;

-- name: DeleteReminder :execrows
DELETE FROM reminders
WHERE id = $1;

-- name: DeleteExpiredOneTimeRemindersByTeam :execrows
DELETE FROM reminders
WHERE team_id = $1
  AND kind = 'one_time'
  AND start_date < $2;
