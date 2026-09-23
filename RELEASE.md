# RCXT Radar v4.0.0 — Functional Analytics Suite

Release status: **OFFICIAL PRODUCTION SNAPSHOT**

## v4 design rule

RCXT v4 distinguishes three kinds of information:

1. **Measured data** — on-chain wallet values, DexScreener market data, GeckoTerminal OHLCV candles and recent trades, Solana contract/holder data, persisted wallet/scan history.
2. **Computed analytics** — RCXT Score, technical indicators, support/resistance, trade-flow summaries, profit ladders, position-risk math, challenge progress.
3. **Estimated scenarios** — short-horizon forecast ranges derived from volatility and momentum. These are not guaranteed targets or probabilities of profit.

## Real OHLCV market lab

- GeckoTerminal public on-chain OHLCV integration
- 1m / 5m / 15m / 1h chart intervals
- server-side short cache and rate limiting
- candlestick visualization
- EMA 9 / EMA 21
- SMA 20 / SMA 50
- RSI 14
- ATR and ATR %
- realized return volatility
- volume acceleration
- recent range high / low
- max observed drawdown
- support and resistance zones
- nearest support / resistance distance
- structure risk-reward ratio
- volatility regime
- structure regime
- RCXT-vs-chart agreement status

## Forecast Lab

- 15-minute scenario range
- 1-hour scenario range
- 6-hour scenario range
- bear / base / bull price bands
- model confidence and data-quality score
- confidence is explicitly **not** a probability of profit
- scenario bands expand with observed ATR/volatility and directional bias
- limited-data tokens automatically receive lower confidence

## Recent-trade tape / whale-flow analytics

- cached GeckoTerminal recent-trade feed
- recent buy and sell USD volume
- net USD flow
- buy-volume share
- average and median trade size
- largest recent buy
- largest recent sell
- unique-wallet count
- dynamic whale threshold
- whale buy/sell counts and USD volume
- top-trade concentration
- flags for buy/sell-volume dominance, whale pressure, trade concentration, and low wallet diversity

## Profit List

Built to answer the same market-cap questions users normally calculate manually:

- configurable position amount
- configurable entry market cap
- common target-MC ladder
- custom market-cap target
- target multiple
- projected position value
- projected P/L
- projected ROI
- configurable estimated trading-cost percentage
- one-tap Copy Profit List
- quick $20 / $40 / $100 position presets
- one-tap use-current-market-cap entry

The calculator uses market-cap ratios and explicitly warns that real fills vary with liquidity, fees, slippage, taxes, supply changes, and execution.

## Decision Stack

- combines RCXT core signal, chart trend, liquidity, and recent USD trade flow
- labels overall evidence as STRONG CONFLUENCE / CONSTRUCTIVE / MIXED / DEFENSIVE / HIGH RISK
- keeps confirming evidence and conflicts separate
- deliberately does not convert confluence into a fake win probability

## Exit Planner

- configurable take-profit %
- configurable scale-out %
- configurable stop distance %
- projected target position value
- projected stop value
- first scale-out value
- runner value
- shared inputs with the Profit List and Position Planner for consistent planning

## Saved Trade Plans

- persistent per-token plan stored locally on the device
- position size
- entry market cap
- TP %
- scale-out %
- stop %
- thesis
- invalidation condition
- one-tap Copy Plan
- save timestamp
- no automatic order execution

## Position Planner

- account value
- maximum risk %
- stop / invalidation distance %
- risk budget
- maximum theoretical position size
- position as % of account
- planned position as % of reported pool liquidity
- liquidity-burden state

This is a risk-planning calculator, not an order executor.

## Beginner Mode

RCXT v4 includes two layers:

- deterministic plain-English explanations that work without an AI provider
- AI **Beginner** and **Pro** modes

Beginner mode explains what the score means, liquidity/exit risk, chart state, and the biggest invalidation in plain language. Pro mode retains the compact market-structure analysis.

AI model fallback chain remains:
1. openai/gpt-5.6-sol
2. openai/gpt-5.6-luna
3. deterministic fallback

## $5 → $50K Challenge Tracker

- wallet-linked equity sync
- fixed $5 reference and $50K goal
- explicitly shows the full target is 10,000x total growth
- logarithmic progress display
- milestones: $5, $10, $25, $50, $100, $250, $500, $1K, $2.5K, $5K, $10K, $25K, $50K
- current equity
- next milestone
- % required to next milestone
- high-water mark
- drawdown from high-water mark
- required multiple from current equity to $50K
- persisted server wallet snapshots
- device-local challenge start time so old wallet history does not distort a new run
- reset challenge-start control
- equity-history sparkline

The challenge is a measurement dashboard, not a promise or compounding strategy.

## Privacy cleanup

The old hard-coded public test-wallet value was removed from the production frontend. Wallet addresses are user-entered and can be stored locally on the device instead of being shipped in public source code.

## Score Engine 4.1 concentration upgrade

- resolves owners behind the largest Solana token accounts when RPC data is available
- uses resolved-owner concentration instead of raw token-account concentration for scoring when possible
- retains raw token-account concentration for transparency and fallback
- bumps the score-engine version so calibration data from the older concentration method is not mixed with 4.1 outcomes

## Existing v3 systems retained

- RCXT Score Engine 4.1
- Trench Mode
- fresh/new-pair Radar
- direct Pump.fun links
- Watchlist
- Hide Coin
- Compare
- alerts
- token journal
- wallet intelligence
- CSV exports
- score calibration
- OIDC-secured Supabase writes
- iPhone/PWA layout
- SFO Vercel Functions
- Social Intelligence remains intentionally reserved for v5 until official provider connections are active

## Data providers

- Solana JSON-RPC
- DexScreener
- GeckoTerminal / CoinGecko on-chain public API
- Supabase
- Vercel AI Gateway when available

## Reliability notes

- Chart/tape upstream calls have timeouts, rate limits, and short caches
- GeckoTerminal chart/tape provider is included in /api/health with latency reporting
- System Health drawer shows chart-provider status alongside Solana, DexScreener, and Supabase
- Market scanner and Radar remain independent of chart-provider failure
- AI failure falls back to deterministic analysis
- challenge history failure does not affect wallet loading
- social providers remain excluded from v4 scoring
- estimates are labeled separately from measured market data

Production: https://rcxt-radar.vercel.app

Rollback branch: `release/v4.0.0`


## Final v4 hardening additions

### Whale Wallet Detection
- sampled public trade-wallet aggregation
- per-wallet buy USD / sell USD / net flow
- trade count and sampled-volume share
- ACCUMULATING / DISTRIBUTING / MIXED behavior labels
- multi-whale accumulation and distribution flags
- whale-flow concentration flag
- Solscan links for public wallet inspection
- whale context can support or weaken Entry Quality, but cannot override core RCXT structural risk

### Supply Whale Detection
- resolves largest Solana token accounts to owner wallets when RPC data permits
- top resolved owner percentages
- counts owner wallets holding at least 5% of supply
- Solscan links
- kept separate from active trade-whale flow

### Trade Quality / Manipulation Analytics
- micro-trade noise percentage
- tiny-trade percentage
- repeat-wallet churn
- top-wallet trade share
- top-wallet USD-volume share
- average-to-median trade-size skew
- Rug / Manipulation Guard consumes these anomalies as evidence

### Score Calibration v2
- clean-sample headline metrics require complete Setup / Execution / Safety / Data Quality scores
- 1h / 6h / 24h outcomes must fall inside controlled timing windows
- raw legacy statistics remain available separately for debugging
- database constraints enforce 0–100 score/component/confidence ranges
- calibration-specific partial indexes accelerate complete-model-version queries
- Setup / Execution / Safety / Data Quality stored as first-class scan columns
- market state and risk-flag count stored per scan
- forward outcomes grouped by score-engine version
- 10-point score-bucket calibration
- signal + risk + horizon segmentation
- average and median realized return
- directional hit rate
- observation-delay tracking
- component-score/forward-return correlation views
- conservative UI sample thresholds before statistics are interpreted
- score history now includes component-score deltas

### Entry / Execution Analytics
- Entry Quality score is separate from RCXT Score and Trench Score
- VWAP location
- volatility-band width / compression / expansion
- support/resistance geometry
- recent USD flow quality
- whale distribution / concentration penalties
- saved per-token Trade Plan
- Exit Planner
- reverse target market-cap calculator
- break-even market-cap calculator
- execution checklist

### Challenge Risk Analytics
- max drawdown
- recovery needed to regain high-water mark
- 24h equity change when enough snapshots exist
- equity volatility
- drawdown guard
- challenge remains a measurement dashboard, not a compounding instruction

### Reliability Gates
- Node 22 CI
- unit tests for trading math and market analytics
- regression tests for whale-flow effects
- production build runs tests before Vite compilation
- GitHub CI validates every main/release push
- Supabase writes remain OIDC-authenticated (logger v17)
- GeckoTerminal chart/tape health monitored separately
- /api/health reports exact live Git SHA, region, deployment URL, and engine versions

## Final-launch condition

The final v4 repository is considered launch-ready only when:
1. GitHub CI passes on the exact final SHA.
2. Vercel deploys that exact SHA successfully.
3. /api/health build.gitSha reports the same SHA.
4. health, scanner, chart, trades, wallet, challenge, calibration, persistence and runtime logs pass production smoke tests.

The final deployment was reduced to the Hobby-plan serverless-function limit by consolidating redundant build diagnostics into /api/health; no user-facing analytics feature was removed.
