-- name: ListShoppingItemsByTeamID :many
SELECT id, team_id, name, notes, sort_key, created_at, updated_at
FROM shopping_items
WHERE team_id = $1
ORDER BY sort_key, created_at, id;

-- name: GetShoppingItemByID :one
SELECT id, team_id, name, notes, sort_key, created_at, updated_at
FROM shopping_items
WHERE id = $1;

-- name: GetShoppingItemMaxSortKeyByTeamID :one
SELECT COALESCE(MAX(sort_key), 0)::integer AS sort_key
FROM shopping_items
WHERE team_id = $1;

-- name: CreateShoppingItem :exec
INSERT INTO shopping_items (id, team_id, name, notes, sort_key, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: UpdateShoppingItem :exec
UPDATE shopping_items
SET name = $2,
    notes = $3,
    updated_at = $4
WHERE id = $1;

-- name: DeleteShoppingItem :execrows
DELETE FROM shopping_items
WHERE id = $1;

-- name: UpdateShoppingItemSortKey :exec
UPDATE shopping_items
SET sort_key = $2,
    updated_at = $3
WHERE id = $1;
