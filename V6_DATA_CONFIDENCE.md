# RCXT Radar V6 — Data Confidence Layer

V6 changes the scoring philosophy from **one market feed + heuristics** to **facts + independent corroboration + explicit uncertainty**.

## Launch provider stack

### Always-on / no paid dependency

1. **Solana RPC — primary on-chain truth**
   - Mint authority
   - Freeze authority
   - Supply
   - Largest token accounts
   - Resolved owner concentration
   - Public RPC remains the final fallback
   - Native Token-2022 extension inspection when parsed extension state is exposed by RPC:
     - transfer fees
     - permanent delegate
     - transfer hook
     - frozen-by-default accounts
     - non-transferable / paused state
     - mint close authority

2. **DexScreener — primary fast market feed**
   - Price
   - Market cap / FDV
   - Liquidity
   - Volume
   - Transactions / buy-sell flow
   - Pair age and DEX identity

3. **GeckoTerminal — independent market cross-check**
   - Price
   - Liquidity/reserve
   - FDV / market cap when available
   - 24h volume and change
   - Cached aggressively so the public API is not spammed

4. **RugCheck — independent Solana security evidence**
   - Rugged/security flags
   - Top-holder percentages
   - Insider-marked holder share
   - LP lock/liquidity metadata
   - Jupiter verification metadata

5. **GoPlus Solana Token Security (Beta) — second security cross-check**
   - Mintable/freezable status when supplied
   - Mutable metadata
   - Blacklist / transfer-pause capabilities
   - Default frozen account state
   - Holder concentration and creator share when supplied
   - Fails soft if the beta API is unavailable or rate-limited

### Optional keyed upgrades

6. **Jupiter Tokens + Price V3**
   - Organic Score
   - Verification and suspicious-token signal
   - Holder / market metadata
   - Independently filtered live price source
   - A Jupiter price omission is treated as unavailable evidence, not automatic proof of danger

7. **Helius**
   - DAS fungible-token metadata
   - Auxiliary token price when available (not used as a real-time veto because Helius fungible pricing can be cached)
   - Supply / decimals / token program corroboration
   - Automatic Solana RPC fallback when a key is configured

8. **Birdeye**
   - Token overview price/liquidity/volume cross-check
   - Solana token-security fields when the account plan exposes them
   - Token-2022 transfer-fee signal
   - Mutable metadata, freeze/mint authority corroboration
   - Creator and top-holder concentration
   - Any unavailable endpoint fails soft instead of breaking RCXT
   - CU-consuming Birdeye market/security calls are opt-in for launch

## V6 score rules

- Concrete on-chain facts outrank vendor aggregate scores.
- Missing data never counts as proof of safety.
- Price sources are compared against the median rather than blindly averaged.
- A material live price disagreement blocks promotion into a buy setup and caps confidence until feeds converge.
- Authority disagreements lower confidence and disable the “contract verified” state.
- Rugged evidence is a hard veto.
- Blacklist, default-frozen and transfer-pause capabilities are structural-danger evidence.
- Jupiter suspicious status is strong caution evidence but is **not** mislabeled as a confirmed rug.
- External holder concentration is used only when stronger on-chain owner/account concentration is unavailable.
- Token-2022 transfer fees reduce execution quality.
- A permanent delegate, non-transferable mint, paused mint or frozen-by-default account state is treated as structural danger for meme-token execution.
- Transfer hooks are caution evidence because custom logic executes on transfers; they are not automatically labeled a rug.
- Mutable metadata and high creator concentration reduce safety.
- Organic activity can strengthen or weaken setup quality; it cannot guarantee direction.
- RCXT score, setup, execution, safety, data quality and confidence remain separate axes. None is a probability of profit.

## Market consensus

V6 can compare:

- DexScreener
- GeckoTerminal
- Jupiter Price V3
- Helius DAS price
- Birdeye token overview

The scanner records:

- price source count,
- external price source count,
- median price,
- maximum source deviation,
- price agreement/conflict,
- liquidity-source conflict,
- market-evidence quality.

Market consensus is persisted into Supabase with each manual scan for future calibration.

## Environment variables

Core:
- `SOLANA_RPC_URL`
- `GOPLUS_ENABLED=1`

Optional:
- `RUGCHECK_API_KEY`
- `GOPLUS_ACCESS_TOKEN`
- `JUPITER_API_KEY`
- `JUPITER_KEYLESS_ENABLED=0`
- `HELIUS_API_KEY`
- `BIRDEYE_API_KEY`
- `BIRDEYE_MARKET_ENABLED=0`
- `BIRDEYE_SECURITY_ENABLED=0`

None of the optional provider keys is required for the app to boot or scan.

## Calibration path

V6 stores security consensus and market consensus inside `token_scans.payload`. Existing forward-outcome labeling can therefore answer questions such as:

- Did low Organic Score predict worse follow-through?
- How often did price-source conflicts precede bad entries?
- Which holder-concentration thresholds best predict drawdown?
- Do creator concentration or mutable metadata deserve stronger weights?
- How much does multi-provider agreement improve score reliability?

Weights should move based on those measured outcomes, not intuition alone.

## Launch cost controls

- GeckoTerminal is the default second market feed and is cached to respect the public API rate limit.
- GoPlus is attempted as a free security cross-check and fails soft.
- Helius is only called when a key exists; it also becomes an RPC fallback.
- Birdeye calls remain disabled even when a key is present until the matching enable flag is set. This prevents accidental CU burn during 15-second scanner refreshes.
- Helius fungible price is stored as auxiliary evidence and cannot by itself trigger a price-source conflict.
