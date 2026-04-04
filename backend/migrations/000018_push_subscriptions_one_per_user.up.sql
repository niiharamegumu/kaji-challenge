DELETE FROM push_subscriptions AS older
USING push_subscriptions AS newer
WHERE older.team_id = newer.team_id
  AND older.user_id = newer.user_id
  AND (
    older.updated_at < newer.updated_at
    OR (older.updated_at = newer.updated_at AND older.id < newer.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_team_user_unique
  ON push_subscriptions (team_id, user_id);
