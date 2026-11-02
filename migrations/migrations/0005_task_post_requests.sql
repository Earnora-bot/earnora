CREATE TABLE IF NOT EXISTS task_post_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target_url TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'manual',
  chat_id TEXT,
  tx_hash TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_post_requests_status
ON task_post_requests(status);
