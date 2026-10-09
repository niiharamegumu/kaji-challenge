-- OAuth token/code persistence belongs to workers-oauth-provider's KV namespace.
-- D1 stores consent consumption and the current application-side revocation state.
CREATE TABLE mcp_connections (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  resource TEXT NOT NULL,
  scopes TEXT NOT NULL,
  grant_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  CONSTRAINT mcp_connections_scopes_check CHECK (json_valid(scopes) AND json_type(scopes) = 'array'),
  CONSTRAINT mcp_connections_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX mcp_connections_user_idx ON mcp_connections(user_id, created_at);
CREATE UNIQUE INDEX mcp_connections_grant_uq ON mcp_connections(grant_id);

CREATE TABLE mcp_consent_claims (
  handle_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES auth_session(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX mcp_consent_claims_expiry_idx ON mcp_consent_claims(expires_at);
