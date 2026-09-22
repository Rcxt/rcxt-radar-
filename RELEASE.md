# RCXT Radar v3.0.0 — Social Intelligence + Calibration Production

Release status: **OFFICIAL PRODUCTION SNAPSHOT**

## RCXT Score Engine v4.0.0

RCXT's headline score is a risk-adjusted decision-support score, not a probability of profit.

Four independent dimensions are calculated:

- **Setup** — multi-timeframe momentum, order flow, volume acceleration, timeframe agreement
- **Execution** — liquidity, liquidity-to-market-cap depth, transaction depth, sustainable turnover
- **Safety** — pair maturity, mint/freeze controls, concentration when available
- **Data Quality** — completeness and depth of the evidence behind the score

Critical weaknesses cap the overall score. Strong volume or social hype cannot average away dangerous execution, contract, concentration, or collapsing momentum.

## Social Intelligence v2

RCXT now includes production provider adapters for:

- Reddit
- X
- Instagram

The social engine normalizes:

- relevant mentions
- recency-weighted mentions
- unique authors
- engagement
- sentiment
- exact token relevance
- duplicate-content rate
- author concentration
- cross-source confirmation

Social evidence is intentionally lower-trust than market/contract evidence and does not directly rescue a weak core score.

Provider configuration is environment-driven. Missing credentials are shown honestly as OFFLINE rather than replaced with mock data.

## AI Analyst

AI analysis now receives:

- RCXT v4 setup/execution/safety/data-quality scores
- market and order-flow data
- contract/security evidence
- social evidence when available

Model chain:

1. openai/gpt-5.6-sol
2. openai/gpt-5.6-luna
3. deterministic RCXT v4 analyst fallback

AI outputs persist separately in `ai_analyses` so they cannot pollute token-scan history or model calibration.

## Empirical Calibration

RCXT now has forward-outcome infrastructure.

When a later manual scan lands inside a valid observation window, RCXT can label earlier scans at:

- 1 hour
- 6 hours
- 24 hours

Stored calibration data includes realized return, directional outcome, observation delay, signal, and score-engine version.

The UI refuses to present a hit-rate statistic until at least 20 comparable signal samples exist. Different score-engine versions are never mixed.

## Secure Persistence

All production writes to Supabase are authenticated with signed Vercel OIDC identity.

Supabase verifies:

- Vercel token signature
- expected Vercel owner/team
- expected RCXT project
- production environment

A copied publishable key alone cannot authorize token, wallet, social, or AI writes.

Server-only RLS tables include:

- token_scans
- wallet_snapshots
- social_scans
- ai_analyses
- score_outcomes

## Performance + Reliability

- Vercel Functions run in **sfo1**
- Supabase runs in **us-west-1**
- 5-second token market refresh
- 10-second opportunity-radar refresh
- 60-second social refresh
- DexScreener short-lived cache and retry
- Solana security cache
- upstream request timeouts
- API rate limits
- production security headers
- Node 22.x pinned
- Vite 7.3.6 pinned
- React error boundary
- PWA/service-worker support

## iPhone 17 Pro / modern iOS

- safe-area-aware Dynamic Island and home-indicator layout
- dynamic viewport units
- 48px primary touch targets
- Safari-safe 16px form inputs
- sticky scanner controls
- safe-area bottom navigation
- compact score/social/calibration panels
- reduced horizontal overflow
- reduced-motion support
- accessibility zoom remains enabled

## Production validation

Before release:

- app health passed
- Solana health passed
- DexScreener health passed
- Supabase logger v11 passed
- strict OIDC token-scan persistence passed
- strict OIDC wallet persistence passed
- AI history separation verified
- calibration labeling verified
- calibration aggregate API verified
- latest production runtime warning/error/fatal logs were empty

## External provider status

Social adapters are deployed and ready, but each provider only becomes LIVE after its official API credentials are added to Vercel.

Required variables are documented in `.env.example`.

Vercel AI Gateway model execution remains subject to the account's Gateway/billing availability. The deterministic analyst fallback remains operational.

## Production URL

https://rcxt-radar.vercel.app

## Release policy

The branch `release/v3.0.0` is the immutable rollback snapshot for this build.
Future development continues on `main`.
