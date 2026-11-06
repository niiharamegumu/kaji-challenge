CREATE TABLE shared_pages (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  document_json TEXT NOT NULL,
  preview TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
  lease_user_id TEXT,
  lease_expires_at TEXT,
  CONSTRAINT shared_pages_document CHECK (json_valid(document_json)),
  CONSTRAINT shared_pages_version CHECK (version >= 0),
  CONSTRAINT shared_pages_title CHECK (length(title) BETWEEN 1 AND 200),
  CONSTRAINT shared_pages_lease CHECK (
    (lease_user_id IS NULL AND lease_expires_at IS NULL)
    OR (lease_user_id IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);
CREATE INDEX shared_pages_team_updated_idx ON shared_pages(team_id, updated_at, id);
