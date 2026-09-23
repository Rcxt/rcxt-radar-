import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://vmiaajhjcdqtojpyicux.supabase.co'

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_55I4aMBK66DBjB3imBmoxg_gWKRz3Zv'

const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/


function getQuery(req, name, fallback = '') {
  try {
    const url = new URL(req.url || '/', 'https://rcxt.local')
    return url.searchParams.get(name) ?? fallback
  } catch {
    return fallback
  }
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({success:false,error:'Method not allowed'})

  const limited=rateLimit(req,{key:'history',limit:30,windowMs:60_000})
  applyRateHeaders(res,limited,30)
  if(!limited.allowed) return res.status(429).json({success:false,error:'Too many history requests. Try again shortly.'})

  const address=String(getQuery(req, 'address')).trim()
  if(!addressPattern.test(address)) return res.status(400).json({success:false,error:'Invalid Solana token address.'})

  try{
    const response=await fetch(`${SUPABASE_URL}/functions/v1/rcxt-log?token=${encodeURIComponent(address)}&limit=20`,{
      headers:{apikey:SUPABASE_PUBLISHABLE_KEY},
      cache:'no-store',
      signal:AbortSignal.timeout(3000),
    })
    const data=await response.json()
    if(!response.ok||!data?.ok) throw new Error(data?.error||'History request failed')

    const rows=(data.rows||[]).map((row)=>({
      score:Number(row.score||0),
      scoreVersion:row.score_version||null,
      signal:row.signal||'WATCH',
      risk:row.risk||null,
      confidence:Number(row.confidence||0),
      setupScore:row.setup_score==null?null:Number(row.setup_score),
      executionScore:row.execution_score==null?null:Number(row.execution_score),
      safetyScore:row.safety_score==null?null:Number(row.safety_score),
      dataQualityScore:row.data_quality_score==null?null:Number(row.data_quality_score),
      marketState:row.market_state||null,
      riskFlagCount:row.risk_flag_count==null?null:Number(row.risk_flag_count),
      priceUsd:Number(row.price_usd||0),
      marketCap:Number(row.market_cap||0),
      liquidityUsd:Number(row.liquidity_usd||0),
      volume24h:Number(row.volume_24h||0),
      createdAt:row.created_at,
    }))

    return res.status(200).json({success:true,address,count:rows.length,rows})
  }catch(error){
    return res.status(502).json({success:false,error:error?.message||'History service unavailable.'})
  }
}
