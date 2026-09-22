# RCXT Radar v2.0.0 — Official Production Build

Release status: **LOCKED PRODUCTION SNAPSHOT**

This release records the first official production-grade RCXT Radar build.

## Verified production systems
- Vite + React 19 production frontend
- Vercel production deployment
- Solana JSON-RPC wallet and mint inspection
- SPL + Token-2022 wallet holdings
- DexScreener market enrichment
- RCXT deterministic scoring and signal engine
- 5-second token scanner refresh
- 10-second opportunity radar refresh
- contract mint/freeze authority checks
- Supabase scan-history persistence
- opportunity radar search, sort, and filters
- watchlist and hidden-token controls
- four-token compare mode
- market pulse
- portfolio concentration/risk metrics
- market-cap scenario calculator
- per-token trade journal
- CSV exports
- iPhone/PWA support
- service-worker notifications while the app is active
- health endpoint for app, Solana, and DexScreener
- Safari-safe automatic JSX runtime and React error boundary

## External limitation
The deterministic RCXT intelligence engine is fully operational. GPT-backed analysis remains on fallback mode until Vercel AI Gateway account billing is enabled.

## Production URL
https://rcxt-radar.vercel.app

## Release policy
The branch `release/v2.0.0` is the immutable rollback snapshot for this build. Future development should occur on `main` and should not modify the release branch.
