# RCXT Radar v3.1.0 — All-in-One Command Center

Release status: **OFFICIAL PRODUCTION SNAPSHOT**

## Command Center
- new main dropdown menu for navigation and advanced workspace tools
- Watchlist manager
- Hidden Coins manager
- Recent Scans launcher
- System Health drawer
- Alert Center shortcut
- Export Center
- one-tap Radar presets: Safer, Balanced, Discovery
- workspace reset that preserves saved watchlist/hidden coins

## Hide Coin
- Radar cards retain Hide Coin
- Deep Scanner now includes Hide Coin / Restore Coin
- hidden list persists locally across refreshes
- global restore controls available from the Command Center

## Social Intelligence
- UI deliberately marked COMING SOON
- Reddit, X, and Instagram provider adapters remain deployed underneath
- no mock/fake social data is shown
- social intelligence does not affect RCXT score until verified provider data is connected

## Mobile / iPhone
- command menu adapts to narrow iPhone layouts
- safe-area-aware full-height workspace drawer
- touch-friendly controls
- command menu remains clear of bottom navigation and home indicator

## Existing production systems retained
- Score Engine 4.0.0
- 5-second token scanner
- 10-second Radar
- OIDC-secured Supabase persistence
- wallet snapshots + SOL valuation
- score calibration infrastructure
- AI model fallback
- SFO Vercel functions
- RLS-protected server-side history

## Release validation
- production homepage: 200
- health endpoint: 200 / healthy
- radar endpoint: 200
- scanner endpoint: 200
- current production warning/error/fatal logs: none

Production: https://rcxt-radar.vercel.app

The branch `release/v3.1.0` is the rollback snapshot for this build.
