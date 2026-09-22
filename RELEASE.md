# RCXT Radar v2.2.0 — Risk-Adjusted Production Build

Release status: **OFFICIAL PRODUCTION SNAPSHOT**

## RCXT Score Engine v4.0.0
- separates Setup, Execution, Safety, and Data Quality
- overall score is risk-adjusted rather than a raw activity score
- critical weak dimensions cap the headline score
- bot/churn-style extreme turnover is no longer treated as a free positive
- multi-timeframe momentum agreement/conflict is explicitly scored
- strongest BUY SETUP requires verified contract controls
- Radar/Wallet remain preliminary until a full scanner security check
- stablecoins keep directional signals suppressed
- headline score remains aligned with WATCH / REDUCE / SELL states
- score history only compares scans created by the same model version

## Backend additions
- Supabase Edge logger v6
- protected token score-history reads
- /api/history endpoint with rate limiting
- scanner 5-second refresh does not create database spam
- manual scans persist score version for comparable history
- manual wallet snapshots persist total portfolio history
- app, Solana, DexScreener, and Supabase health checks
- pinned Node 22 runtime line
- pinned Vite 7.3.6 production dependency
- upstream caching, retry logic, request timeouts, and route rate limits
- security headers on production responses

## iPhone 17 Pro / iOS
- viewport-fit=cover and safe-area-aware top/bottom layout
- dynamic viewport units for modern Safari
- Dynamic Island / home-indicator clearance
- 48px primary touch targets
- 16px form controls to prevent unwanted Safari zoom
- keyboard-friendly sticky token scanner
- fixed bottom navigation with safe-area clearance
- compact score axes for narrow screens
- reduced horizontal overflow
- reduced-motion support
- iOS-specific backdrop and control handling
- accessibility zoom remains enabled

## Score interpretation
RCXT Score is a risk-adjusted market/setup score. It is not a probability of profit and does not guarantee future price direction.

## External limitation
GPT analysis still depends on Vercel AI Gateway account billing. The deterministic RCXT v4 scoring engine and fallback analyst remain functional without it.

## Production URL
https://rcxt-radar.vercel.app

## Release policy
The branch `release/v2.2.0` is the immutable rollback snapshot for this build.
Future development continues on `main`.
