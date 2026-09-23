# RCXT Radar V6 — Data Confidence Layer

V6 changes the scoring philosophy from "one feed plus heuristics" to "facts + corroboration + explicit uncertainty."

## Provider hierarchy

1. **Solana RPC — primary on-chain truth**
   - Mint authority
   - Freeze authority
   - Supply
   - Largest token accounts
   - Resolved owner concentration when RPC data is available

2. **RugCheck — independent security corroboration**
   - Rugged/security flags
   - Top-holder percentages
   - Insider-marked holder share
   - LP lock/liquidity metadata
   - Jupiter verification metadata
   - Used as evidence, not as a blind aggregate vendor score

3. **Jupiter Tokens V2 — optional organic/verification evidence**
   - Organic activity score
   - Verification state
   - Holder count / liquidity / market cap metadata
   - Audit authority fields when supplied
   - Free API key recommended; no paid plan is required by this implementation

## Scoring rules

- Concrete on-chain facts outrank vendor aggregate scores.
- Missing data never counts as proof of safety.
- A provider disagreement lowers model confidence.
- Explicit external structural danger can cap the total score.
- Rugged evidence is a hard veto.
- External concentration is only a fallback when stronger on-chain owner/account concentration is unavailable.
- Organic activity can strengthen or weaken setup quality, but it does not independently prove a rug or guarantee price direction.
- RCXT score, opportunity score, safety score, execution score and confidence are separate axes. None is a probability of profit.

## New scan output

The token scan now carries:
- merged `security` evidence,
- `intelligence.securityEvidence.providerCount`,
- `evidenceScore`,
- provider conflicts,
- rugged status,
- external danger count,
- insider percentage,
- Jupiter organic score,
- Jupiter verification,
- authority corroboration state.

## Environment variables

- `RUGCHECK_API_KEY` — optional.
- `JUPITER_API_KEY` — optional; free key preferred.
- `JUPITER_KEYLESS_ENABLED=0` — keyless Jupiter access remains off unless intentionally enabled.

## Planned next data upgrades

These are intentionally not required for the first V6 preview:
- Helius as a stronger production RPC / wallet-activity source when a free key is available.
- GoPlus Solana Token Security as a third security cross-check after its Solana Beta behavior is validated against real tokens.
- Historical calibration in Supabase to measure how score components correlate with later liquidity, drawdown and survival outcomes.

The first V6 preview should prove that provider disagreement and missing data are handled correctly before adding more vendors.
