# RCXT Radar

RCXT Radar is a Solana market-intelligence workstation focused on functional analytics, explainable risk signals, wallet tracking, fresh-pair discovery, and decision-support tools.

## Production

https://rcxt-radar.vercel.app

Current production release: **v4.0.0**

## Main systems

### RCXT Score Engine 4.0

The headline score is a risk-adjusted decision-support score, not a probability of profit.

Core dimensions:

- Setup
- Execution
- Safety
- Data Quality

Critical weaknesses cap the score so activity, hype, or volume cannot average away structural risk.

### Trench Mode

Fresh-pair workflow for viable pairs up to roughly six hours old.

Includes:

- Trench Score
- 5m and 1h flow
- liquidity floor
- seller/collapse caps
- HOT / ACTIVE / WATCH / QUIET / REVERSAL / SELLERS / EXTENDED / THIN / DUMPING states
- direct Pump.fun links where applicable

### V4 Market Lab

Real OHLCV candles are sourced server-side from GeckoTerminal.

Indicators and analytics:

- 1m / 5m / 15m / 1h candles
- EMA / SMA
- RSI
- ATR
- realized volatility
- volume acceleration
- support / resistance
- risk-reward structure
- short-horizon volatility-based scenario ranges
- RCXT + chart agreement

### Trade Tape

Recent GeckoTerminal trades are normalized into:

- buy/sell USD volume
- net flow
- buy-volume percentage
- average/median trade size
- largest buy/sell
- whale-flow summary
- unique wallets
- concentration/pressure flags

### Profit List + Position Planner

Profit List converts a position amount and entry market cap into common and custom target-MC outcomes.

Position Planner works backward from account value, risk %, and invalidation distance to estimate a maximum theoretical position size and liquidity burden.

### Beginner / Pro explanations

The scanner includes deterministic beginner explanations plus AI Beginner and Pro modes.

The AI layer never changes the deterministic RCXT score.

### $5 → $50K challenge

Wallet-linked equity tracker with milestone progress, high-water mark, drawdown, required multiple, challenge-scoped history, and server snapshots.

It is a tracker, not a promise that $5 will become $50K.

## Backend

- React 19 + Vite
- Vercel Functions in sfo1
- Solana JSON-RPC
- DexScreener
- GeckoTerminal
- Supabase Edge Function + Postgres
- OIDC-authenticated server writes
- Vercel AI Gateway with deterministic fallback

## Security

Production Supabase writes require signed Vercel OIDC identity and are RLS-protected server-side.

Never commit API secrets or service-role credentials.

## Social Intelligence

Reddit, X, and Instagram adapters exist but remain a **v5 / Coming Soon** feature until official provider credentials and live-data validation are complete.

## Important interpretation

Measured market data, computed analytics, and estimated scenario ranges are intentionally labeled differently. RCXT does not guarantee future prices, profitable trades, or execution quality.
