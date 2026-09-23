import { getRadarCandidates } from '../lib/dexscreener.js'
import { SCORE_VERSION } from '../lib/intelligence.js'
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
      headers: { accept:'application/json', 'user-agent':'RCXT-Radar/4.0' },
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

  const healthy=Object.values(services).every((item)=>item.ok)

  res.setHeader('Cache-Control','no-store')
  return res.status(healthy?200:207).json({
    success:true,
    healthy,
    checkedAt:new Date().toISOString(),
    scoreVersion:SCORE_VERSION,
    services,
    refresh:{radarSeconds:10,scannerSeconds:5,chartsSeconds:30,tradeTapeSeconds:30},
    build:{
      app:'RCXT Radar',
      version:'4.0.0',
      scoreEngine:SCORE_VERSION,
      trenchEngine:'1.0.0',
      chartEngine:'1.0.0',
      forecastEngine:'1.0.0',
      tradeTapeEngine:'1.2.0',
      supplyWhaleEngine:'1.0.0',
      calibrationEngine:'2.0.0',
      challengeEngine:'1.1.0',
      walletActivityEngine:'1.0.0',
      persistence:'supabase-oidc-v16',
      gitSha:process.env.VERCEL_GIT_COMMIT_SHA||null,
      gitRef:process.env.VERCEL_GIT_COMMIT_REF||null,
      environment:process.env.VERCEL_ENV||null,
      region:process.env.VERCEL_REGION||null,
      deploymentUrl:process.env.VERCEL_URL||null,
    },
    ai:{mode:'multi-model-gateway-with-deterministic-fallback'},
    oidc:{available:Boolean(req.headers?.['x-vercel-oidc-token'])},
    socialProviders:{
      reddit:Boolean(
        process.env.REDDIT_BEARER_TOKEN ||
        (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET)
      ),
      x:Boolean(process.env.X_BEARER_TOKEN),
      instagram:Boolean(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_USER_ID)
    }
  })
}
