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

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({success:false,error:'Method not allowed'})

  const started=Date.now()
  const [solana,dexscreener,supabase]=await Promise.all([
    testSolana(),
    testDex(),
    checkPersistenceHealth(),
  ])

  const services={
    app:{ok:true,latencyMs:Date.now()-started},
    solana,
    dexscreener,
    supabase,
  }

  const healthy=Object.values(services).every((item)=>item.ok)

  res.setHeader('Cache-Control','no-store')
  return res.status(healthy?200:207).json({
    success:true,
    healthy,
    checkedAt:new Date().toISOString(),
    scoreVersion:SCORE_VERSION,
    services,
    refresh:{radarSeconds:10,scannerSeconds:5},
    ai:{mode:'gateway-with-deterministic-fallback'}
  })
}
