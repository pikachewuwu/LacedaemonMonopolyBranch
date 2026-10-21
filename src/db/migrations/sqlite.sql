--das gleiche wie postgres.sql nur für sqlite

CREATE TABLE IF NOT EXISTS catalog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK (category IN ('anime', 'games')),
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category, title_key)
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  member_name TEXT NOT NULL,
  member_key TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  status TEXT NOT NULL CHECK (status IN ('planned', 'ongoing', 'completed','dropped','on_hold')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, member_key)
);
CREATE INDEX IF NOT EXISTS idx_reviews_item_id ON reviews(item_id);

CREATE TABLE IF NOT EXISTS economy_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_name TEXT NOT NULL UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  is_demo INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- discord-mitglieder und login-sitzungen (token nur als sha256-hash gespeichert)
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS member_profile_descriptions (
  member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS mal_anime (
  mal_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  creator_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mal_anime_entries (
  mal_id INTEGER NOT NULL REFERENCES mal_anime(mal_id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('watching', 'plan_to_watch', 'completed', 'on_hold', 'dropped')),
  watched_episodes INTEGER CHECK (watched_episodes BETWEEN 0 AND 100000),
  score INTEGER CHECK (score BETWEEN 1 AND 10),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (mal_id, member_id),
  CONSTRAINT mal_anime_entries_fields_check CHECK ((status = 'plan_to_watch' AND watched_episodes IS NULL AND score IS NULL)
    OR (status IN ('watching', 'on_hold', 'dropped') AND watched_episodes IS NOT NULL AND score IS NULL)
    OR (status = 'completed' AND watched_episodes IS NOT NULL AND watched_episodes > 0))
);
CREATE INDEX IF NOT EXISTS idx_mal_anime_entries_member ON mal_anime_entries(member_id);

CREATE TABLE IF NOT EXISTS steam_games (
  app_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS steam_game_reviews (
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

-- Unveränderlicher Ersteller und Hinzufügezeitpunkt, getrennt vom Steam-Datenstand.
CREATE TABLE IF NOT EXISTS steam_game_entries (
  steam_app_id INTEGER PRIMARY KEY REFERENCES steam_games(app_id) ON DELETE CASCADE,
  creator_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Alte Steam-Einträge nur bei eindeutig erster Bewertung einem Ersteller zuordnen.
-- Bei gleichem Zeitstempel bleibt der Ersteller unbekannt; spätere Bewertungen
-- dürfen diesen Eintrag nicht übernehmen.
INSERT INTO steam_game_entries (steam_app_id, creator_member_id, created_at)
SELECT g.app_id,
  (SELECT CASE WHEN COUNT(*) = 1 THEN MIN(r.member_id) ELSE NULL END
   FROM steam_game_reviews r WHERE r.steam_app_id = g.app_id
     AND r.created_at = (SELECT MIN(first.created_at) FROM steam_game_reviews first WHERE first.steam_app_id = g.app_id)),
  COALESCE((SELECT MIN(r.created_at) FROM steam_game_reviews r WHERE r.steam_app_id = g.app_id), datetime(g.fetched_at / 1000, 'unixepoch'))
FROM steam_games g WHERE 1 = 1
ON CONFLICT(steam_app_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_member_id ON sessions(member_id);

-- abgeschlossene monopoly-partien
CREATE TABLE IF NOT EXISTS monopoly_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  map_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  turns INTEGER NOT NULL,
  winner_name TEXT NOT NULL,
  winner_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  players_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_monopoly_games_ended_at ON monopoly_games(ended_at);
