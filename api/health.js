import { getBestPair, getRadarCandidates } from '../lib/dexscreener.js'
import { analyzePair, SCORE_VERSION } from '../lib/intelligence.js'
import { getMintSecurity } from '../lib/solana.js'
import { getExternalSecurity, mergeSecurityEvidence } from '../lib/external-security.js'
import { buildMarketConsensus, getMarketConsensus } from '../lib/market-consensus.js'
import { checkPersistenceHealth } from '../lib/supabase-log.js'

async function testSolana() {
  const started = Date.now()
  try {
    const response = await fetch(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc:'2.0', id:'rcxt-health', method:'getHealth', params:[] }),
      signal: AbortSignal.timeout(3500),
    })
    const json = await response.json()
    return { ok:response.ok && !json?.error, latencyMs:Date.now()-started }
  } catch {
    return { ok:false, latencyMs:Date.now()-started }
  }
}

async function testDex() {
  const started = Date.now()
  try {
    const pairs = await getRadarCandidates(1)
    return { ok:Array.isArray(pairs) && pairs.length>0, latencyMs:Date.now()-started }
  } catch {
    return { ok:false, latencyMs:Date.now()-started }
  }
}

async function testCharts() {
  const started = Date.now()
  try {
    const response = await fetch('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1', {
      headers: { accept:'application/json', 'user-agent':'RCXT-Radar/6.0' },
      signal: AbortSignal.timeout(3500),
    })
    const json = await response.json()
    return {
      ok: response.ok && Array.isArray(json?.data),
      latencyMs: Date.now()-started,
      provider: 'GeckoTerminal',
    }
  } catch {
    return { ok:false, latencyMs:Date.now()-started, provider:'GeckoTerminal' }
  }
}

const PREVIEW_SMOKE_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'

async function testPreviewV6() {
  const started = Date.now()
  try {
    const [pair,onchainSecurity,externalSecurity,externalMarket] = await Promise.all([
      getBestPair(PREVIEW_SMOKE_MINT),
      getMintSecurity(PREVIEW_SMOKE_MINT),
      getExternalSecurity(PREVIEW_SMOKE_MINT),
      getMarketConsensus(PREVIEW_SMOKE_MINT, null),
    ])
    if (!pair) return { ok:false, latencyMs:Date.now()-started, error:'Known liquid smoke token has no market.' }

    const market = buildMarketConsensus(pair, externalMarket?.providers || {})
    const security = mergeSecurityEvidence(onchainSecurity, externalSecurity, market)
    const intelligence = analyzePair(pair, security)
    const securityProviderCount = Number(security?.external?.providerCount || 0)
    const priceProviderCount = Number(market?.priceProviderCount || 0)
    const checks = {
      dexMarket:Boolean(pair),
      solanaSecurity:Boolean(onchainSecurity?.available),
      finiteScore:Number.isFinite(Number(intelligence?.score)),
      scoreVersion:intelligence?.modelVersion === SCORE_VERSION,
      geckoterminal:Boolean(market?.providers?.geckoterminal?.available),
      securityCorroboration:securityProviderCount >= 2,
      priceCorroboration:priceProviderCount >= 2,
    }

    return {
      ok:Object.values(checks).every(Boolean),
      latencyMs:Date.now()-started,
      token:pair?.baseToken?.symbol || 'BONK',
      address:PREVIEW_SMOKE_MINT,
      persisted:false,
      score:{
        version:intelligence?.modelVersion || null,
        value:intelligence?.score ?? null,
        signal:intelligence?.signal || null,
        risk:intelligence?.risk || null,
        confidence:intelligence?.confidence ?? null,
      },
      evidence:{
        securityProviderCount,
        securityProviders:security?.external?.providers || [],
        securityEvidenceScore:security?.external?.evidenceScore ?? null,
        securityConflicts:security?.external?.dataConflicts || [],
        priceProviderCount,
        externalPriceProviderCount:Number(market?.externalPriceProviderCount || 0),
        marketEvidenceScore:market?.evidenceScore ?? null,
        priceConflict:Boolean(market?.priceConflict),
        maxPriceDeviationPercent:market?.maxDeviationPercent ?? null,
        rugcheck:Boolean(externalSecurity?.rugcheck?.available),
        goplus:Boolean(externalSecurity?.goplus?.available),
        geckoterminal:Boolean(market?.providers?.geckoterminal?.available),
        jupiterToken:Boolean(externalSecurity?.jupiter?.available),
        jupiterPrice:Boolean(market?.providers?.jupiterPrice?.available),
        helius:Boolean(market?.providers?.helius?.available),
        birdeyeMarket:Boolean(market?.providers?.birdeye?.available),
        birdeyeSecurity:Boolean(externalSecurity?.birdeye?.available),
      },
      checks,
      bubbleMap:`https://v2.bubblemaps.io/map?address=${PREVIEW_SMOKE_MINT}&chain=solana&partnerId=regular`,
    }
  } catch (error) {
    return { ok:false, latencyMs:Date.now()-started, persisted:false, error:error?.message || 'Preview V6 smoke failed.' }
  }
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({success:false,error:'Method not allowed'})

  const started=Date.now()
  const [solana,dexscreener,supabase,charts]=await Promise.all([
    testSolana(),
    testDex(),
    checkPersistenceHealth(),
    testCharts(),
  ])

  const services={
    app:{ok:true,latencyMs:Date.now()-started},
    solana,
    dexscreener,
    supabase,
    charts,
  }

  const previewSmoke = process.env.VERCEL_ENV === 'preview' ? await testPreviewV6() : null
  const coreHealthy=Object.values(services).every((item)=>item.ok)
  const healthy=coreHealthy && (previewSmoke ? previewSmoke.ok : true)

  res.setHeader('Cache-Control','no-store')
  return res.status(healthy?200:207).json({
    success:true,
    healthy,
    checkedAt:new Date().toISOString(),
    scoreVersion:SCORE_VERSION,
    services,
    previewSmoke,
    refresh:{radarSeconds:10,scannerSeconds:15,chartsSeconds:30,tradeTapeSeconds:30,walletOpenSeconds:15,walletBackgroundSeconds:30},
    build:{
      app:'RCXT Radar',
      version:'6.0.0',
      scoreEngine:SCORE_VERSION,
      trenchEngine:'1.0.0',
      chartEngine:'1.0.0',
      forecastEngine:'1.0.0',
      tradeTapeEngine:'1.2.0',
      supplyWhaleEngine:'1.0.0',
      calibrationEngine:'2.0.0',
      challengeEngine:'1.1.0',
      walletActivityEngine:'1.2.0',
      notificationEngine:'2.0.0',
      persistence:'supabase-oidc-v17',
      gitSha:process.env.VERCEL_GIT_COMMIT_SHA||null,
      gitRef:process.env.VERCEL_GIT_COMMIT_REF||null,
      environment:process.env.VERCEL_ENV||null,
      region:process.env.VERCEL_REGION||null,
      deploymentUrl:process.env.VERCEL_URL||null,
    },
    ai:{mode:'multi-model-gateway-with-deterministic-fallback'},
    oidc:{available:Boolean(req.headers?.['x-vercel-oidc-token'])},
    socialProviders:{
      x:Boolean(process.env.X_BEARER_TOKEN)
    },
    visualProviders:{
      bubblemaps:{ enabled:true, mode:'direct-token-link', scoreInput:false }
    },
    dataProviders:{
      core:{
        solanaRpc:true,
        dexscreener:true,
        geckoterminal:true,
        rugcheck:true,
        goplus:String(process.env.GOPLUS_ENABLED || '1') !== '0',
      },
      optional:{
        jupiter:Boolean(process.env.JUPITER_API_KEY) || String(process.env.JUPITER_KEYLESS_ENABLED || '0') === '1',
        helius:Boolean(process.env.HELIUS_API_KEY),
        birdeye:{
          configured:Boolean(process.env.BIRDEYE_API_KEY),
          marketEnabled:Boolean(process.env.BIRDEYE_API_KEY) && String(process.env.BIRDEYE_MARKET_ENABLED || '0') === '1',
          securityEnabled:Boolean(process.env.BIRDEYE_API_KEY) && String(process.env.BIRDEYE_SECURITY_ENABLED || '0') === '1',
        },
      },
      policy:'Missing optional providers lower corroboration depth; they do not break scans or count as proof of safety.'
    },
    launch:{
      candidate:process.env.VERCEL_ENV !== 'production',
      productionPromoted:process.env.VERCEL_ENV === 'production',
      requiredServicesHealthy:coreHealthy,
      previewSmokeHealthy:previewSmoke ? previewSmoke.ok : null,
      note:process.env.VERCEL_ENV === 'production'
        ? 'RCXT Radar V6 is promoted to production.'
        : 'V6 final build is awaiting production promotion.'
    }
  })
}
