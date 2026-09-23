# RCXT Radar V5 — X Intelligence

Branch: `release/v5-x-social`

## Goal

V5 replaces the old multi-provider social placeholder with one focused source: **X**.

RCXT searches:
- exact Solana contract address
- cashtag ticker (for example `$SOMO`)
- exact coin name
- bare ticker only when it is long enough to avoid obvious false matches, with Solana/crypto context

Reddit and Instagram are intentionally excluded.

## Live data requirement

Set this as a **server-side** Vercel environment variable:

`X_BEARER_TOKEN`

Do not expose it in Vite/frontend variables and do not commit it.

Optional:
- `X_SEARCH_PAGES=1` — 1 to 3 pages, up to 100 posts per page.
- `X_FULL_ARCHIVE_ENABLED=0` — switch to `1` only if the X developer account supports full-archive search.

Without a bearer token, the V5 panel stays functional but reports **X OFFLINE** instead of inventing data.

## What RCXT calculates

The X engine reports:
- relevant mention count
- 15m / 1h / 3h / 24h mention windows
- mention-rate acceleration
- unique authors
- verified-account mentions
- 10K+ follower account mentions
- engagement and reported impressions
- relevance score
- sentiment
- duplicate-text ratio
- author concentration
- low-follower and new-account share
- promo/shill phrase density
- organic score
- shill/coordination risk
- narrative keywords
- repeated catalyst chatter
- repeated risk claims
- high-impact posts ranked by relevance, recency, engagement and author reach

## AI report

The existing `/api/ai` route gains `mode: "social"`.

The AI receives only the normalized X report and token snapshot. It is instructed to:
- separate attention from quality
- distinguish social claims from verified facts
- mention weak sample sizes
- flag duplicate/coordinated-looking behavior without claiming an account is definitely a bot
- avoid turning X hype into a price prediction or buy/sell instruction

Sections:
1. X PULSE
2. WHAT X IS SAYING
3. QUALITY CHECK
4. WHAT TO WATCH

## Reliability rules

Social data does **not** override contract, liquidity, wallet-flow or execution-risk checks.

A high X momentum score can coexist with high token risk. That should read as **attention/hype**, not automatic confirmation.

The server caches X results for about 60 seconds to avoid unnecessary repeated API calls while the scanner auto-refreshes.
