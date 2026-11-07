-- A deleted page leaves its request receipt so a delayed retry cannot recreate it.
CREATE TABLE shared_page_creations (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id, request_id)
);
