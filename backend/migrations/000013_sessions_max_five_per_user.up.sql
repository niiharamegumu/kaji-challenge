DROP INDEX IF EXISTS uq_sessions_user_id;

WITH ranked_sessions AS (
  SELECT token,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY created_at DESC, token DESC
         ) AS rn
  FROM sessions
)
DELETE FROM sessions AS s
USING ranked_sessions AS r
WHERE s.token = r.token
  AND r.rn > 5;
