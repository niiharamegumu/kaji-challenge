DROP INDEX IF EXISTS users_oidc_issuer_subject_uq;

ALTER TABLE users
  DROP COLUMN IF EXISTS oidc_linked_at,
  DROP COLUMN IF EXISTS oidc_subject,
  DROP COLUMN IF EXISTS oidc_issuer;
