# RCXT Radar v3.2.0 — Trench Mode

Release status: **OFFICIAL PRODUCTION SNAPSHOT**

## Trench Mode
- dedicated Trench preset in Command Center
- focuses on viable pairs up to 6 hours old
- sorts by independent Trench Score
- uses pair age, 5m activity, 1h activity, liquidity, discovery quality, and buy/sell balance
- seller dominance and extreme moves cap Trench Score
- states: HOT, ACTIVE, WATCH, QUIET, REVERSAL, SELLERS, EXTENDED, THIN
- main RCXT Score remains independent and visible at all times

## New-pair discovery
- Radar mixes DexScreener latest token profiles, latest boosts, and top boosts
- roughly half of the candidate feed is reserved for viable sub-24h pairs when available
- age labels: JUST LAUNCHED, VERY NEW, NEW, RECENT, ESTABLISHED
- Early Discovery and Newest sorting
- dead/illiquid launches do not rank purely because they are new

## Pump.fun
- Pump.fun-origin / PumpSwap tokens receive a direct Pump.fun button on Radar
- Deep Scanner also receives a Pump.fun link when the token is eligible
- canonical token route uses https://pump.fun/coin/<mint>
- DexScreener links remain available

## Risk controls
- Trench Score is not a probability of profit
- high short-term activity cannot override RCXT contract/liquidity/risk warnings
- heavy 1h seller dominance caps Trench Score
- fresh 5m rebounds after seller-heavy 1h flow are labeled REVERSAL instead of HOT

## Existing systems retained
- RCXT Score Engine 4.0
- All-in-One Command Center
- Hide Coin / Watchlist / Compare
- 5-second scanner
- 10-second Radar
- iPhone-safe mobile UI
- OIDC-secured persistence
- wallet intelligence
- calibration infrastructure
- AI fallback chain
- SFO compute

## Validation
- production deployment READY
- Radar returned 24 live candidates
- sub-6h pairs confirmed live
- Trench Score/state confirmed live
- Pump.fun URLs populated for eligible tokens
- production warning/error/fatal logs: none

Production: https://rcxt-radar.vercel.app

Rollback branch: `release/v3.2.0`
