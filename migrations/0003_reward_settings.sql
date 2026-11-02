-- Earnora reward settings migration
-- Task reward: $0.05 = 5 cents
-- Watch Ad reward: $0.01 = 1 cent
-- Referral reward: $0.05 = 5 cents
-- Minimum withdrawal: $3.00 = 300 cents

-- Update existing task rewards
UPDATE tasks
SET reward_cents = 5;

-- Keep ad reward at $0.01
UPDATE ad_events
SET reward_cents = 1;

-- Replace the old referral-only balance trigger.
-- The new trigger credits the user's balance for every
-- new ledger entry, including task and referral rewards.

DROP TRIGGER IF EXISTS trg_referral_reward_credit;
DROP TRIGGER IF EXISTS trg_ledger_credit;

CREATE TRIGGER trg_ledger_credit
AFTER INSERT ON ledger
BEGIN
    UPDATE users
    SET balance_cents = balance_cents + NEW.amount_cents
    WHERE telegram_id = NEW.telegram_id;
END;
