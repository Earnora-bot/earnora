-- Track ad reward claims separately; keep ad_events.status compatible with
-- the existing CHECK constraint (pending, verified, rejected).

ALTER TABLE ad_events ADD COLUMN claimed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_ad_events_claimed
ON ad_events(telegram_id, status, claimed_at);
