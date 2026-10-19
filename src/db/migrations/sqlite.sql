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
  status TEXT NOT NULL CHECK (status IN ('planned', 'ongoing', 'completed')),
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
