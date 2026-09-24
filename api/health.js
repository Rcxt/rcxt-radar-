import { getBestPair, getRadarCandidates } from '../lib/dexscreener.js'
import { analyzePair, SCORE_VERSION } from '../lib/intelligence.js'
import { getMintSecurity } from '../lib/solana.js'
import { getEvmSecurity } from '../lib/evm-security.js'
import { getChain, listChains } from '../lib/chains.js'
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
const PREVIEW_ROBINHOOD_MINT = '0x3458e003F6ED93df0F537b8AcaC6FbE08E41247f'

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

async function testPreviewRobinhood() {
  const started=Date.now()
  const chain=getChain('robinhood')
  try{
    const [pair,onchainSecurity,externalSecurity,externalMarket]=await Promise.all([
      getBestPair(PREVIEW_ROBINHOOD_MINT,chain),
      getEvmSecurity(PREVIEW_ROBINHOOD_MINT,chain),
      getExternalSecurity(PREVIEW_ROBINHOOD_MINT,chain),
      getMarketConsensus(PREVIEW_ROBINHOOD_MINT,null,chain),
    ])
    if(!pair) return {ok:false,latencyMs:Date.now()-started,error:'Known Robinhood smoke token has no market.'}

    const market=buildMarketConsensus(pair,externalMarket?.providers||{})
    const security=mergeSecurityEvidence(onchainSecurity,externalSecurity,market)
    const intelligence=analyzePair(pair,security)
    const checks={
      dexMarket:Boolean(pair),
      evmContractCode:onchainSecurity?.contractCodePresent===true,
      finiteScore:Number.isFinite(Number(intelligence?.score)),
      scoreVersion:intelligence?.modelVersion===SCORE_VERSION,
      geckoterminal:Boolean(market?.providers?.geckoterminal?.available),
      goplus:Boolean(externalSecurity?.goplus?.available),
      priceCorroboration:Number(market?.priceProviderCount||0)>=2,
      securityModel:intelligence?.securityEvidence?.securityModel==='evm-token',
    }

    return {
      ok:Object.values(checks).every(Boolean),
      latencyMs:Date.now()-started,
      chain:'robinhood',
      token:pair?.baseToken?.symbol||'ROO',
      address:PREVIEW_ROBINHOOD_MINT.toLowerCase(),
      persisted:false,
      score:{
        version:intelligence?.modelVersion||null,
        value:intelligence?.score??null,
        signal:intelligence?.signal||null,
        risk:intelligence?.risk||null,
        confidence:intelligence?.confidence??null,
        contractVerified:Boolean(intelligence?.contractVerified),
      },
      evidence:{
        securityProviderCount:Number(security?.external?.providerCount||0),
        securityProviders:security?.external?.providers||[],
        priceProviderCount:Number(market?.priceProviderCount||0),
        priceConflict:Boolean(market?.priceConflict),
        geckoterminal:Boolean(market?.providers?.geckoterminal?.available),
        goplus:Boolean(externalSecurity?.goplus?.available),
        openSource:externalSecurity?.goplus?.openSource??null,
        honeypot:externalSecurity?.goplus?.honeypot??null,
        buyTaxPercent:externalSecurity?.goplus?.buyTaxPercent??null,
        sellTaxPercent:externalSecurity?.goplus?.sellTaxPercent??null,
      },
      checks,
    }
  }catch(error){
    return {ok:false,latencyMs:Date.now()-started,persisted:false,error:error?.message||'Robinhood V6.1 smoke failed.'}
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

  const previewSmoke = process.env.VERCEL_ENV === 'preview'
    ? {
        solana:await testPreviewV6(),
        robinhood:await testPreviewRobinhood(),
      }
    : null
  const coreHealthy=Object.values(services).every((item)=>item.ok)
  const previewSmokeHealthy=previewSmoke ? previewSmoke.solana.ok && previewSmoke.robinhood.ok : true
  const healthy=coreHealthy && previewSmokeHealthy

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
      version:'6.1.0-rc.1',
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
      persistence:'supabase-oidc-v18-multichain',
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
    multichain:{
      scanner:true,
      marketLab:true,
      history:true,
      persistence:true,
      radar:'solana-only',
      wallet:'solana-only',
      supported:listChains().map((chain)=>({
        id:chain.id,
        label:chain.label,
        family:chain.family,
        chainId:chain.chainId??null,
      })),
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
      previewSmokeHealthy:previewSmoke ? previewSmokeHealthy : null,
      note:process.env.VERCEL_ENV === 'production'
        ? 'RCXT Radar multichain release is promoted to production.'
        : 'V6.1 multichain release candidate is awaiting production promotion.'
    }
  })
}
