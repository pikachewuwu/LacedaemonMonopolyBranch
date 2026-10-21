CREATE TABLE steam_game_reviews_v2 (
  steam_app_id INTEGER NOT NULL REFERENCES steam_games(app_id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  score INTEGER CHECK (score BETWEEN 1 AND 10),
  status TEXT NOT NULL CHECK (status IN ('planned', 'ongoing', 'paused', 'completed')),
  priority TEXT CHECK (priority IN ('high', 'medium', 'low')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (steam_app_id, member_id),
  CHECK ((status = 'planned' AND priority IS NOT NULL AND score IS NULL)
    OR (status = 'ongoing' AND priority IS NULL AND score IS NULL)
    OR (status IN ('paused', 'completed') AND priority IS NULL AND score IS NOT NULL))
);
INSERT INTO steam_game_reviews_v2 (steam_app_id, member_id, score, status, priority, created_at, updated_at)
SELECT steam_app_id, member_id, CASE WHEN status = 'completed' THEN score ELSE NULL END,
  status, CASE WHEN status = 'planned' THEN 'medium' ELSE NULL END, created_at, updated_at
FROM steam_game_reviews;
DROP TABLE steam_game_reviews;
ALTER TABLE steam_game_reviews_v2 RENAME TO steam_game_reviews;
