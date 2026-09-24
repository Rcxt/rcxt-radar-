# RCXT Radar V6.1 — Multichain Intelligence

V6.1 expands the token scanner and Market Lab from Solana-only analysis to chain-aware Solana + EVM analysis while keeping the Solana wallet/radar workflows intact.

## Supported scanner networks

- Solana
- Robinhood Chain (EVM chain ID 4663)
- Ethereum
- Base
- BNB Chain
- Arbitrum
- Polygon
- Optimism
- Avalanche
- Monad

The scanner supports **Auto-detect** for EVM token contracts by resolving exact token markets through DexScreener. A manual network selector remains available when the same contract address exists on more than one chain or auto-detection is ambiguous.

## Evidence model

### Solana
- Solana RPC: mint account, supply, Token-2022 extensions and holder-account evidence
- DexScreener: primary market/pair data
- GeckoTerminal: independent price/liquidity + OHLCV/trade-tape corroboration
- RugCheck: holder/insider/rug evidence
- GoPlus: independent Solana token-security evidence
- Jupiter / Helius / Birdeye: optional corroboration when configured
- Bubblemaps: visual holder-cluster investigation, not an automatic score input

### EVM
- Chain RPC: eth_getCode confirms contract bytecode exists
- DexScreener: primary market/pair data and auto-chain discovery
- GeckoTerminal: independent market, OHLCV and trade-tape corroboration
- GoPlus Token Security: open-source status, honeypot/cannot-sell behavior, hidden or recoverable ownership, balance-changing owner controls, self-destruct, transfer pausing, proxy status, mintability, buy/sell taxes and holder concentration

EVM tokens are **not** scored with Solana mint/freeze-authority logic. EVM contract verification requires chain RPC bytecode plus usable GoPlus evidence, open-source status and no hard contract veto.

## Simple result

- **YES** — current RCXT setup gates pass
- **WAIT** — more confirmation or better execution conditions are needed
- **NO** — current structural/risk controls veto the setup

The verdict shows one primary reason plus Contract, Price Sources and Execution checks. Detailed data remains available in collapsed sections.

## Cross-chain safety rules

- Missing provider data never counts as proof of safety.
- Material price-source disagreement blocks a YES result.
- Honeypot, cannot-sell, malicious-token, hidden-owner/balance-control and similar hard GoPlus findings are structural danger.
- Extremely high EVM taxes sharply reduce execution quality and cap the score.
- Closed-source and proxy contracts reduce confidence/safety but are not automatically called rugs.
- Chain identity is persisted with every token scan so history and calibration never mix the same address across different networks.

## Scope boundary

V6.1 makes **Scanner, Market Lab, scan history and token-scan persistence** multichain.

The following remain intentionally Solana-only in V6.1:
- Opportunity Radar / trench discovery
- Wallet Command Center
- wallet buy monitoring / push notifications

This boundary is exposed from /api/health instead of being hidden.

## Release smoke targets

### Solana
BONK: DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263

Required: Dex market, Solana security, RugCheck + GoPlus, GeckoTerminal, finite V6.1 score, 2+ price sources and 2+ security sources.

### Robinhood Chain
ROO: 0x3458e003F6ED93df0F537b8AcaC6FbE08E41247f

Required: Robinhood market discovery, contract bytecode, GoPlus EVM security, GeckoTerminal, finite V6.1 EVM score and 2+ price sources.

## Persistence

public.token_scans now stores chain_id and chain_family. Existing rows were backfilled as Solana.

The rcxt-log Edge Function v18 accepts Solana and EVM token addresses and scopes token history / calibration by chain_id.

## Launch rule

Do not promote V6.1 from an older partial preview. Only the final validated branch head should be preview-built after the Vercel deployment-rate limit resets. Both Solana and Robinhood preview smoke checks must pass before merge/promotion.
