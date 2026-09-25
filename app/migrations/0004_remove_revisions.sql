-- 業務データを保持したまま、旧クライアントの競合制御を撤去する。
ALTER TABLE teams DROP COLUMN state_revision;
DROP TABLE app_revision;
