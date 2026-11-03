CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_events_provider_event_id
ON ad_events(provider_event_id)
WHERE provider_event_id IS NOT NULL
  AND provider_event_id <> '';

CREATE INDEX IF NOT EXISTS idx_ad_events_user_daily
ON ad_events(telegram_id, created_at, status);
