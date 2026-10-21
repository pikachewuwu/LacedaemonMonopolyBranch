-- CHECK-Constraints bestehender Tabellen lassen sich in SQLite nur durch
-- einen Tabellenneuaufbau ändern. Der Aufrufer führt alles atomar aus.
CREATE TABLE mal_anime_entries_v2 (
  mal_id INTEGER NOT NULL REFERENCES mal_anime(mal_id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('watching', 'plan_to_watch', 'completed', 'on_hold', 'dropped')),
  watched_episodes INTEGER CHECK (watched_episodes BETWEEN 0 AND 100000),
  score INTEGER CHECK (score BETWEEN 1 AND 10),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (mal_id, member_id),
  CONSTRAINT mal_anime_entries_fields_check CHECK (
    (status = 'plan_to_watch' AND watched_episodes IS NULL AND score IS NULL)
    OR (status IN ('watching', 'on_hold', 'dropped') AND watched_episodes IS NOT NULL AND score IS NULL)
    OR (status = 'completed' AND watched_episodes IS NOT NULL AND watched_episodes > 0))
);

INSERT INTO mal_anime_entries_v2 (mal_id, member_id, status, watched_episodes, score, created_at, updated_at)
SELECT mal_id, member_id, status, watched_episodes, score, created_at, updated_at FROM mal_anime_entries;

DROP TABLE mal_anime_entries;
ALTER TABLE mal_anime_entries_v2 RENAME TO mal_anime_entries;
CREATE INDEX idx_mal_anime_entries_member ON mal_anime_entries(member_id);
