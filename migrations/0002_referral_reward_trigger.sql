-- Earnora Referral Auto Reward Trigger
-- Reward: $0.10 per verified referral

CREATE TRIGGER IF NOT EXISTS trg_referral_reward_credit
AFTER INSERT ON ledger
WHEN NEW.reason = 'referral_reward'
BEGIN
  UPDATE users
  SET balance_cents = balance_cents + NEW.amount_cents
  WHERE telegram_id = NEW.telegram_id;
END;
