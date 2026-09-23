# RCXT Radar V5.1 RC — Clarity, Alerts, Scoring

## What changed

### Simpler scanner delivery
- The marketing hero disappears once a token is scanned so the decision data moves above the fold.
- Quick Read now separates:
  - RCXT tradability score
  - Opportunity / momentum
  - Execution quality
  - Risk + directional bias
- Core market metrics and the market-cap plan are collapsible.
- Score caps are transparent: RCXT can show the raw weighted score and the exact cap reasons.
- WATCH / BUY gating comes from the server score engine instead of being re-created independently in the UI.

### Score Engine 5.0.0
- Adds `scoreBeforeCaps`, `scoreCaps`, and structured `entryGate` output.
- Missing Pump.fun AMM liquidity remains unknown instead of literal $0.
- Data-quality scoring treats market cap and liquidity coverage separately.
- Confidence is capped when mint-security, concentration, or liquidity data is missing.
- Informational risk-flag counts no longer automatically force EXTREME risk.
- Structural danger (active authorities / extreme concentration) keeps the hard veto.

### Notification Engine 2.0
Default **KEY ONLY** preset:
- New buy: ON
- Rug / contract danger: ON
- High-risk buy: ON
- Hot momentum + high risk: OFF
- Key signal changes: ON
- Every signal flip: OFF
- Score threshold: OFF
- Market-cap threshold: OFF
- Radar changes: OFF
- X momentum: OFF
- Repeat same-token buy alerts: OFF
- Same-token/category cooldown: 20 minutes

Other presets:
- ACTIVE TRADER
- EVERYTHING
- SILENT

Background monitor preferences are stored server-side in `monitor_wallets.preferences`.

### Anti-spam behavior
- Repeated buy alerts are grouped by token + alert category.
- The same token/category is suppressed during the configured cooldown unless repeat alerts are enabled.
- A different critical category (for example a new rug/contract danger) can still break through.
- When 24/7 Live Monitor is active, Wallet Activity does not send a duplicate foreground copy.
- Service-worker notifications replace matching tags; only critical alerts request re-notification.

### X intelligence notifications
When enabled, visible scanner sessions can alert on:
- IGNITING X momentum
- NEGATIVE PRESSURE
- SHILL-HEAVY feed quality

These use the same cooldown preference.

## Data / security
- Notification preferences are server-only behind the existing Vercel OIDC → Supabase control path.
- `anon` and `authenticated` still have no direct policies for monitor tables.
- No service-role or push private keys are exposed to the frontend.

## Release state
This is a release candidate branch until GitHub CI, Vite build, Supabase cron, and Vercel deployment checks pass.
