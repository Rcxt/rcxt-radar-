# RCXT Radar

RCXT Radar is a Solana market-intelligence workstation built with React + Vite and Vercel Functions.

## Production architecture

- Solana JSON-RPC wallet + mint inspection
- SPL and Token-2022 holdings
- DexScreener live market enrichment
- RCXT risk-adjusted score engine
- 5-second market scanner refresh
- 10-second opportunity-radar refresh
- 60-second social-intelligence refresh
- Supabase scan, wallet, social, and calibration persistence
- iPhone-first PWA interface
- Vercel AI Gateway analyst with a deterministic fallback

## RCXT Score Engine

The score is **not a probability of profit**. It is a risk-adjusted decision-support score built from separate dimensions:

- **Setup** — multi-timeframe momentum, order flow, and volume acceleration
- **Execution** — liquidity, liquidity-to-market-cap depth, turnover, and trading depth
- **Safety** — pair maturity, mint/freeze controls, and concentration when available
- **Data Quality** — how complete the underlying evidence is

Critical weaknesses cap the final score so activity or hype cannot average away structural risk.

## Social intelligence

RCXT includes provider adapters for Reddit, X, and Instagram. Social evidence is deliberately lower-trust than contract/liquidity data because it can be manipulated.

The social layer measures:

- relevant mentions
- recency-weighted mentions
- unique authors
- engagement
- sentiment
- exact token relevance
- duplicate-content rate
- author concentration
- cross-source confirmation

Provider credentials are configured only through environment variables. Never commit them to GitHub.

### Required social environment variables

Reddit:
- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`

Or, alternatively:
- `REDDIT_BEARER_TOKEN`

X:
- `X_BEARER_TOKEN`

Instagram:
- `INSTAGRAM_ACCESS_TOKEN`
- `INSTAGRAM_USER_ID`
- optional `META_GRAPH_VERSION`

## Calibration

Manual token scans create durable score history. When a later manual scan lands close enough to a 1h, 6h, or 24h observation window, RCXT labels the earlier scan with the realized return. Calibration results are grouped by score-engine version so incompatible score generations are never mixed.

Small samples are shown as **collecting data** rather than presented as a trustworthy hit rate.

## Deployment

The connected Vercel project uses the Vite preset. API endpoints under `/api` deploy as Vercel Functions.

Production: https://rcxt-radar.vercel.app

## Safety

RCXT signals are software-generated market intelligence. They are not guarantees, a probability of profit, or automated trading instructions.
