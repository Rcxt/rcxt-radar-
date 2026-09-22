# RCXT Radar v2.1.0 — Hardened Production Build

Release status: **OFFICIAL PRODUCTION SNAPSHOT**

v2.1.0 is the post-audit hardening release of RCXT Radar.

## Intelligence engine
- RCXT deterministic score engine v3.0.0
- tighter score/signal alignment
- WATCH / REDUCE / SELL ceilings to avoid contradictory headline scores
- stronger multi-timeframe momentum penalties
- seller-dominance detection
- parabolic/chase-risk caps
- contract-verification gating: strongest BUY SETUP requires verified mint/freeze authorities
- preliminary scoring flag for Radar/Wallet views that do not perform full contract checks
- optional token-account concentration analysis when Solana RPC supplies largest-account data
- stable-asset directional-signal suppression
- score-version persistence in Supabase

## Backend hardening
- 5-second scanner stays live without writing a database row every refresh
- manual token scans persist; silent auto-refreshes do not
- wallet snapshots persist on manual wallet loads
- live SOL/USD valuation and total wallet value
- soft per-instance API rate limiting for scan, wallet, radar, and AI routes
- upstream Solana/DexScreener request timeouts
- DexScreener retry + short-lived cache layer
- cached token security checks
- partial-success Solana security enrichment
- AI endpoint payload/rate controls
- health endpoint verifies app, Solana, DexScreener, and Supabase
- Supabase Edge logger v5 with explicit auth, payload limits, token/wallet log types
- removed public execution from internal SECURITY DEFINER RLS helper

## Verified persistence
- silent scan refresh: no history row
- manual scan: exactly one history row
- manual wallet load: exactly one wallet snapshot
- score_version stored with token scans

## Frontend transparency
- preliminary Radar labels
- contract verification state
- largest-account / top-10 concentration shown when available
- score engine version shown in production UI

## Known external limitation
Vercel AI Gateway model execution still depends on the Vercel account's billing requirement. RCXT's deterministic analyst fallback remains available.

## Production URL
https://rcxt-radar.vercel.app

## Release policy
The branch `release/v2.1.0` is the immutable rollback snapshot for this build.
Future development continues on `main`.
