-- name: InsertCloseExecutionKey :execrows
INSERT INTO close_execution_keys (key, created_at)
VALUES ($1, NOW())
ON CONFLICT (key) DO NOTHING;
