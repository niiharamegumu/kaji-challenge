-- name: ListShoppingItemsByTeamID :many
SELECT id, team_id, name, quantity, notes, position, created_at, updated_at
FROM shopping_items
WHERE team_id = $1
ORDER BY position, created_at, id;

-- name: GetShoppingItemByID :one
SELECT id, team_id, name, quantity, notes, position, created_at, updated_at
FROM shopping_items
WHERE id = $1;

-- name: GetShoppingItemMaxPositionByTeamID :one
SELECT COALESCE(MAX(position), 0)::integer AS position
FROM shopping_items
WHERE team_id = $1;

-- name: CreateShoppingItem :exec
INSERT INTO shopping_items (id, team_id, name, quantity, notes, position, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: UpdateShoppingItem :exec
UPDATE shopping_items
SET name = $2,
    quantity = $3,
    notes = $4,
    updated_at = $5
WHERE id = $1;

-- name: DeleteShoppingItem :execrows
DELETE FROM shopping_items
WHERE id = $1;

-- name: CompactShoppingItemPositionsAfter :exec
UPDATE shopping_items
SET position = position - 1,
    updated_at = $3
WHERE team_id = $1
  AND position > $2;

-- name: UpdateShoppingItemPosition :exec
UPDATE shopping_items
SET position = $2,
    updated_at = $3
WHERE id = $1;
