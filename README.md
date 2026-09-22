# RCXT Radar

RCXT Radar is a live Solana wallet and token intelligence terminal built with Next.js, Vercel, Supabase, Solana JSON-RPC, DexScreener, and Vercel AI Gateway.

## What is live

- Solana SOL balance
- SPL Token + Token-2022 wallet holdings
- DexScreener token enrichment
- Boosted Solana opportunity radar
- 15-second token auto-refresh
- Mint-authority and freeze-authority checks
- RCXT 0-100 scoring engine
- BUY SETUP / LEAN BUY / WATCH / REDUCE / SELL-Avoid signals
- Signal confidence and risk classification
- Liquidity, turnover, volume acceleration, buy/sell flow, momentum, pair maturity, and contract-risk scoring
- AI analyst powered by Vercel AI Gateway with OIDC
- Supabase scan logging through a sanitized Edge Function
- Responsive dark terminal UI

## Architecture

### Frontend
Next.js App Router on Vercel.

### Live market data
- Solana JSON-RPC
- DexScreener API

### Intelligence
The deterministic RCXT score is the source of truth. The AI analyst explains the score and identifies contradictions; it does not overwrite the deterministic signal.

### AI
The deployed Vercel app uses AI Gateway OIDC, so no OpenAI API key is committed or required in the repository.

### Supabase
The database remains RLS locked. Public clients do not receive database write credentials. A narrow Edge Function validates a publishable Supabase key and writes only sanitized token-scan telemetry.

## Optional environment variable

```bash
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

A dedicated Solana RPC is recommended for heavier production traffic.

## API routes

- `GET /api/radar`
- `GET /api/scan?address=<token-ca>`
- `GET /api/wallet?address=<wallet>`
- `POST /api/ai`

## Important

RCXT Radar provides software-generated market intelligence. Signals are not guarantees or personalized financial advice, and meme-coin markets can move extremely quickly.
