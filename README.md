# Earnora

Telegram Mini App powered by Cloudflare Workers and D1.

## Current configuration

- Worker: `earnora`
- D1 binding: `DB` (`earnora-db`)
- Monetag SDK zone: `12181637`
- Monetag reward: `$0.01` per server-confirmed valued impression
- Daily ad-start limit: 100 per Telegram user

## Existing database upgrade

For the existing `earnora-db`, apply **only** `migrations/0007_monetag_claims.sql` once.
Do not run `schema.sql` against an existing database: it is a complete reference schema for a fresh database and is not an incremental migration.

## Monetag setup

1. Add a Cloudflare Worker secret named `MONETAG_POSTBACK_SECRET`. Use a long random value and keep it private.
2. In the Monetag SSP settings for SDK zone `12181637`, configure the postback URL as:

   `https://YOUR-WORKER-DOMAIN/monetag/postback?secret=YOUR_SECRET&ymid={ymid}&zone_id={zone_id}&event_type={event_type}&reward_event_type={reward_event_type}&telegram_id={telegram_id}`

3. Replace `YOUR-WORKER-DOMAIN` with the actual Worker domain and `YOUR_SECRET` with the exact secret stored in Cloudflare. Never put the secret in frontend code or commit it to Git.
4. Deploy the Worker and test a real rewarded impression from inside Telegram. A reward is only available after the server receives a `valued` `impression` postback. Click and non-valued events do not earn rewards.

The browser callback is used only for display feedback. The server-side Monetag postback is the source of truth for reward eligibility. Each `ymid` can be credited once.

## Important

- Do not commit `BOT_TOKEN`, `WEBHOOK_SECRET`, or `MONETAG_POSTBACK_SECRET`.
- Keep Telegram secrets in Cloudflare Worker secrets.
- Existing historical migration files are retained for reference. For an existing deployment, use the specific upgrade above rather than replaying the historical migrations.
