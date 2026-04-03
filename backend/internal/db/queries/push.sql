-- name: UpsertPushSubscription :one
INSERT INTO push_subscriptions (
  id,
  team_id,
  user_id,
  endpoint,
  p256dh,
  auth,
  user_agent,
  platform,
  is_active,
  last_seen_at,
  created_at,
  updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, TRUE, $9, $10, $11)
ON CONFLICT (endpoint) DO UPDATE
SET team_id = EXCLUDED.team_id,
    user_id = EXCLUDED.user_id,
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent,
    platform = EXCLUDED.platform,
    is_active = TRUE,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = EXCLUDED.updated_at
RETURNING id,
          team_id,
          user_id,
          endpoint,
          p256dh,
          auth,
          COALESCE(user_agent, '') AS user_agent,
          platform,
          is_active,
          last_seen_at,
          created_at,
          updated_at;

-- name: ListPushSubscriptionsByUserID :many
SELECT id,
       team_id,
       user_id,
       endpoint,
       p256dh,
       auth,
       COALESCE(user_agent, '') AS user_agent,
       platform,
       is_active,
       last_seen_at,
       created_at,
       updated_at
FROM push_subscriptions
WHERE user_id = $1
ORDER BY is_active DESC, updated_at DESC, id DESC;

-- name: ListActivePushSubscriptionsByTeamID :many
SELECT id,
       team_id,
       user_id,
       endpoint,
       p256dh,
       auth,
       COALESCE(user_agent, '') AS user_agent,
       platform,
       is_active,
       last_seen_at,
       created_at,
       updated_at
FROM push_subscriptions
WHERE team_id = $1
  AND is_active = TRUE
ORDER BY updated_at DESC, id DESC;

-- name: DeactivatePushSubscriptionByIDAndUser :execrows
UPDATE push_subscriptions
SET is_active = FALSE,
    updated_at = $3
WHERE id = $1
  AND user_id = $2;

-- name: DeactivatePushSubscriptionByEndpoint :execrows
UPDATE push_subscriptions
SET is_active = FALSE,
    updated_at = $2
WHERE endpoint = $1
  AND is_active = TRUE;

-- name: ListTeamIDsForPush :many
SELECT DISTINCT team_id
FROM push_subscriptions
WHERE is_active = TRUE
ORDER BY team_id;

-- name: GetPushDispatchState :one
SELECT team_id,
       slot_kind,
       slot_date,
       fingerprint,
       sent_at,
       updated_at
FROM push_dispatch_state
WHERE team_id = $1
  AND slot_kind = $2
  AND slot_date = $3;

-- name: UpsertPushDispatchState :exec
INSERT INTO push_dispatch_state (
  team_id,
  slot_kind,
  slot_date,
  fingerprint,
  sent_at,
  updated_at
)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (team_id, slot_kind, slot_date) DO UPDATE
SET fingerprint = EXCLUDED.fingerprint,
    sent_at = EXCLUDED.sent_at,
    updated_at = EXCLUDED.updated_at;
