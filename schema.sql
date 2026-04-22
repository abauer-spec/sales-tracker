-- ============================================
-- Sales Tracking System — D1 Schema
-- ============================================

CREATE TABLE IF NOT EXISTS agents (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT    NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  amount   REAL    NOT NULL CHECK(amount > 0),
  date     TEXT    NOT NULL DEFAULT (date('now')),
  created_at TEXT  DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_agent  ON transactions(agent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date   ON transactions(date);

-- ============================================
-- Optional seed data (remove in production)
-- ============================================
-- INSERT INTO agents (name) VALUES ('Иван Петров'), ('Мария Сидорова'), ('Алексей Козлов');
