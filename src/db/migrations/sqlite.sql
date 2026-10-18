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
