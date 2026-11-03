PRAGMA foreign_keys = ON;

-- Canonical Earnora D1 schema (current application version).

CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT NOT NULL DEFAULT '',
  balance_cents INTEGER NOT NULL DEFAULT 0 CHECK(balance_cents >= 0),
  reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK(reserved_cents >= 0),
  is_banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inviter_id TEXT NOT NULL,
  invitee_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK(status IN ('unverified','verified','rejected')),
  rewarded INTEGER NOT NULL DEFAULT 0 CHECK(rewarded IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inviter_id) REFERENCES users(telegram_id),
  FOREIGN KEY (invitee_id) REFERENCES users(telegram_id),
  CHECK(inviter_id <> invitee_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  reward_cents INTEGER NOT NULL DEFAULT 5 CHECK(reward_cents > 0),
  target_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  task_type TEXT NOT NULL DEFAULT 'manual',
  chat_id TEXT
);

CREATE TABLE IF NOT EXISTS task_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  task_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','verified','rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  claimed_at TEXT,
  UNIQUE(telegram_id, task_id),
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS ad_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  provider_event_id TEXT UNIQUE,
  reward_cents INTEGER NOT NULL DEFAULT 1 CHECK(reward_cents > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','verified','rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TEXT,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 100),
  payout_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','paid','rejected')),
  tx_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','answered','closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

CREATE INDEX IF NOT EXISTS idx_ad_events_user_daily
  ON ad_events(telegram_id, created_at, status);

CREATE INDEX IF NOT EXISTS idx_ad_events_claimed
  ON ad_events(telegram_id, status, claimed_at);

CREATE INDEX IF NOT EXISTS idx_task_completions_status
  ON task_completions(telegram_id, status);

CREATE INDEX IF NOT EXISTS idx_task_post_requests_status
  ON task_post_requests(status);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user
  ON withdrawals(telegram_id);

-- Every ledger credit is applied exactly once because reference_id is unique.

CREATE TRIGGER IF NOT EXISTS trg_ledger_credit
AFTER INSERT ON ledger
BEGIN
  UPDATE users
  SET balance_cents = balance_cents + NEW.amount_cents
  WHERE telegram_id = NEW.telegram_id;
END;
