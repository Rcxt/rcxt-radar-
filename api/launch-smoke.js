import { getBestPair } from '../lib/dexscreener.js'
import { analyzePair, SCORE_VERSION } from '../lib/intelligence.js'
import { getMintSecurity } from '../lib/solana.js'
import { getExternalSecurity, mergeSecurityEvidence } from '../lib/external-security.js'
import { buildMarketConsensus, getMarketConsensus } from '../lib/market-consensus.js'
import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'

const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success:false, error:'Method not allowed' })
  }

  if (process.env.VERCEL_ENV === 'production') {
    return res.status(404).json({ success:false, error:'Not found' })
  }

  const limited = rateLimit(req, { key:'launch-smoke', limit:10, windowMs:60_000 })
  applyRateHeaders(res, limited, 10)
  if (!limited.allowed) {
    return res.status(429).json({ success:false, error:'Launch smoke rate limit reached.' })
  }

  const started = Date.now()

  try {
    const [pair, onchainSecurity, externalSecurity, externalMarket] = await Promise.all([
      getBestPair(BONK_MINT),
      getMintSecurity(BONK_MINT),
      getExternalSecurity(BONK_MINT),
      getMarketConsensus(BONK_MINT, null),
    ])

    if (!pair) {
      return res.status(503).json({
        success:false,
        scoreVersion:SCORE_VERSION,
        error:'Known liquid launch-smoke token has no active DexScreener market.',
      })
    }

    const marketEvidence = buildMarketConsensus(pair, externalMarket?.providers || {})
    const security = mergeSecurityEvidence(onchainSecurity, externalSecurity, marketEvidence)
    const intelligence = analyzePair(pair, security)

    const securityProviders = Array.isArray(security?.external?.providers)
      ? security.external.providers
      : []

    const required = {
      dexMarket:Boolean(pair),
      solanaSecurity:Boolean(onchainSecurity?.available),
      rugcheck:Boolean(externalSecurity?.rugcheck?.available),
      goplusAttempted:externalSecurity?.goplus?.reason !== 'DISABLED',
      geckoterminal:Boolean(marketEvidence?.providers?.geckoterminal?.available),
      scoreVersion:intelligence?.modelVersion === SCORE_VERSION,
      finiteScore:Number.isFinite(Number(intelligence?.score)),
    }

    const healthy = Object.values(required).every(Boolean)

    res.setHeader('Cache-Control', 'no-store')
    return res.status(healthy ? 200 : 207).json({
      success:true,
      healthy,
      persisted:false,
      checkedAt:new Date().toISOString(),
      latencyMs:Date.now() - started,
      token:{
        address:BONK_MINT,
        name:pair?.baseToken?.name || 'BONK',
        symbol:pair?.baseToken?.symbol || 'BONK',
      },
      score:{
        version:intelligence?.modelVersion || null,
        value:intelligence?.score ?? null,
        signal:intelligence?.signal || null,
        risk:intelligence?.risk || null,
        confidence:intelligence?.confidence ?? null,
      },
      evidence:{
        securityProviderCount:Number(security?.external?.providerCount || 0),
        securityProviders,
        securityEvidenceScore:security?.external?.evidenceScore ?? null,
        securityConflicts:security?.external?.dataConflicts || [],
        priceProviderCount:Number(marketEvidence?.priceProviderCount || 0),
        externalPriceProviderCount:Number(marketEvidence?.externalPriceProviderCount || 0),
        marketEvidenceScore:marketEvidence?.evidenceScore ?? null,
        priceConflict:Boolean(marketEvidence?.priceConflict),
        maxPriceDeviationPercent:marketEvidence?.maxDeviationPercent ?? null,
        geckoterminal:Boolean(marketEvidence?.providers?.geckoterminal?.available),
        jupiterPrice:Boolean(marketEvidence?.providers?.jupiterPrice?.available),
        helius:Boolean(marketEvidence?.providers?.helius?.available),
        birdeyeMarket:Boolean(marketEvidence?.providers?.birdeye?.available),
        rugcheck:Boolean(externalSecurity?.rugcheck?.available),
        goplus:Boolean(externalSecurity?.goplus?.available),
        jupiterToken:Boolean(externalSecurity?.jupiter?.available),
        birdeyeSecurity:Boolean(externalSecurity?.birdeye?.available),
      },
      token2022:{
        detected:Boolean(security?.token2022),
        hardExtensionFlags:intelligence?.securityEvidence?.token2022 || null,
      },
      visual:{
        bubbleMap:`https://v2.bubblemaps.io/map?address=${BONK_MINT}&chain=solana&partnerId=regular`,
        scoreInput:false,
      },
      required,
      optionalProviderPolicy:'Optional provider absence may reduce corroboration depth but does not fail the launch smoke check.',
      git:{
        sha:process.env.VERCEL_GIT_COMMIT_SHA || null,
        ref:process.env.VERCEL_GIT_COMMIT_REF || null,
        environment:process.env.VERCEL_ENV || null,
      },
    })
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(500).json({
      success:false,
      healthy:false,
      persisted:false,
      scoreVersion:SCORE_VERSION,
      latencyMs:Date.now() - started,
      error:error?.message || 'Launch smoke failed.',
    })
  }
}
