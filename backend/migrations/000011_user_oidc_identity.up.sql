ALTER TABLE users
  ADD COLUMN oidc_issuer TEXT,
  ADD COLUMN oidc_subject TEXT,
  ADD COLUMN oidc_linked_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_oidc_issuer_subject_uq
  ON users (oidc_issuer, oidc_subject)
  WHERE oidc_issuer IS NOT NULL AND oidc_subject IS NOT NULL;
