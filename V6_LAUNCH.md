# RCXT Radar V6 Launch Checklist

Release candidate: **6.0.0-rc.1**

## Hard launch gates

- [ ] Latest GitHub CI passes unit tests and production build.
- [ ] Latest Vercel preview is READY.
- [ ] `/api/health` reports required services healthy.
- [ ] Manual scanner returns a V6 score for a liquid known token.
- [ ] Manual scanner returns provider counts and market consensus without a runtime error.
- [ ] A missing optional provider key does not break scanning.
- [ ] Price-source conflict regression prevents BUY SETUP promotion.
- [ ] Rugged / structural-danger regressions remain hard vetoes.
- [ ] Mobile Advanced Data renders source/consensus rows without horizontal overflow.
- [ ] Scan persistence succeeds and records `6.0.0-rc.1` plus evidence payload.
- [ ] Production `main` remains unchanged until all checks above are complete.

## Core provider behavior

Required for launch:
- Solana RPC
- DexScreener
- GeckoTerminal
- RugCheck
- GoPlus attempted with graceful fallback
- Supabase persistence

Optional enhancements:
- Jupiter API key
- Helius API key
- Birdeye API key
- X bearer token for social intelligence

Optional providers must never become boot dependencies.

## Production promotion

When all hard gates pass:

1. Update release notes from RC to V6 final.
2. Merge the V6 PR into `main`.
3. Confirm the new Vercel production deployment is READY.
4. Run `/api/health` on production.
5. Run one manual token scan and one wallet load.
6. Verify mobile Scanner, Radar, Wallet and Advanced Data.
7. Confirm Supabase is receiving V6 scan rows.
8. Only then mark V6 as launched.

## Rollback

The current V5.1 production commit is the rollback anchor until V6 has passed post-deploy smoke checks. Never delete or rewrite that release history.
