ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE tasks ADD COLUMN chat_id TEXT;

ALTER TABLE task_completions
ADD COLUMN claimed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_task_completions_status
ON task_completions(telegram_id, status);
