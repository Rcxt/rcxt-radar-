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
const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/
const chainPattern = /^[a-z0-9_-]{2,32}$/

function finiteOrNull(value){
  if(value===null||value===undefined||value==='') return null
  const number=Number(value)
  return Number.isFinite(number)?number:null
}


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

  const calibration=getQuery(req,'calibration')==='1'
  const limited=rateLimit(req,{
    key:calibration?'calibration':'history',
    limit:calibration?20:30,
    windowMs:60_000,
  })
  applyRateHeaders(res,limited,calibration?20:30)
  if(!limited.allowed){
    return res.status(429).json({
      success:false,
      error:calibration?'Too many calibration requests.':'Too many history requests. Try again shortly.',
    })
  }

  if(calibration){
    try{
      const response=await fetch(`${SUPABASE_URL}/functions/v1/rcxt-log?calibration=1`,{
        headers:{apikey:SUPABASE_PUBLISHABLE_KEY},
        cache:'no-store',
        signal:AbortSignal.timeout(3000),
      })
      const data=await response.json()
      if(!response.ok||!data?.ok) throw new Error(data?.error||'Calibration service unavailable')

      const rows=(data.summary||data.rows||[]).map(row=>({
        scoreVersion:row.score_version,
        signal:row.signal,
        horizon:row.horizon,
        samples:Number(row.samples||0),
        avgReturnPct:row.avg_return_pct==null?null:Number(row.avg_return_pct),
        directionalHitRate:row.directional_hit_rate==null?null:Number(row.directional_hit_rate),
        avgDelayMinutes:row.avg_delay_minutes==null?null:Number(row.avg_delay_minutes),
      }))

      const buckets=(data.buckets||[]).map(row=>({
        scoreVersion:row.score_version,
        scoreBucketMin:Number(row.score_bucket_min||0),
        scoreBucketMax:Number(row.score_bucket_max||0),
        signal:row.signal,
        risk:row.risk,
        horizon:row.horizon,
        samples:Number(row.samples||0),
        avgReturnPct:row.avg_return_pct==null?null:Number(row.avg_return_pct),
        medianReturnPct:row.median_return_pct==null?null:Number(row.median_return_pct),
        directionalHitRate:row.directional_hit_rate==null?null:Number(row.directional_hit_rate),
        avgAbsDelayMinutes:row.avg_abs_delay_minutes==null?null:Number(row.avg_abs_delay_minutes),
      }))

      const components=(data.components||[]).map(row=>({
        scoreVersion:row.score_version,
        horizon:row.horizon,
        setupSamples:Number(row.setup_samples||0),
        setupReturnCorrelation:row.setup_return_corr==null?null:Number(row.setup_return_corr),
        executionSamples:Number(row.execution_samples||0),
        executionReturnCorrelation:row.execution_return_corr==null?null:Number(row.execution_return_corr),
        safetySamples:Number(row.safety_samples||0),
        safetyReturnCorrelation:row.safety_return_corr==null?null:Number(row.safety_return_corr),
        dataQualitySamples:Number(row.data_quality_samples||0),
        dataQualityReturnCorrelation:row.data_quality_return_corr==null?null:Number(row.data_quality_return_corr),
      }))

      const rawRows=(data.rawSummary||[]).map(row=>({
        scoreVersion:row.score_version,
        signal:row.signal,
        horizon:row.horizon,
        samples:Number(row.samples||0),
        avgReturnPct:row.avg_return_pct==null?null:Number(row.avg_return_pct),
        directionalHitRate:row.directional_hit_rate==null?null:Number(row.directional_hit_rate),
        avgDelayMinutes:row.avg_delay_minutes==null?null:Number(row.avg_delay_minutes),
      }))

      return res.status(200).json({
        success:true,
        samplePolicy:data.samplePolicy||'clean-complete-components-with-timing-window',
        totalSamples:rows.reduce((sum,row)=>sum+row.samples,0),
        rawTotalSamples:rawRows.reduce((sum,row)=>sum+row.samples,0),
        rows,
        rawRows,
        buckets,
        components,
      })
    }catch(error){
      return res.status(502).json({success:false,error:error?.message||'Calibration service unavailable.'})
    }
  }

  const address=String(getQuery(req,'address')).trim()
  const chain=String(getQuery(req,'chain','solana')).trim().toLowerCase()
  if(!addressPattern.test(address)&&!evmAddressPattern.test(address)) return res.status(400).json({success:false,error:'Invalid token address.'})
  if(!chainPattern.test(chain)) return res.status(400).json({success:false,error:'Invalid chain id.'})

  try{
    const response=await fetch(`${SUPABASE_URL}/functions/v1/rcxt-log?token=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}&limit=20`,{
      headers:{apikey:SUPABASE_PUBLISHABLE_KEY},
      cache:'no-store',
      signal:AbortSignal.timeout(3000),
    })
    const data=await response.json()
    if(!response.ok||!data?.ok) throw new Error(data?.error||'History request failed')

    const rows=(data.rows||[]).map((row)=>({
      chain:row.chain_id||chain,
      chainFamily:row.chain_family||null,
      score:finiteOrNull(row.score),
      scoreVersion:row.score_version||null,
      signal:row.signal||'WATCH',
      risk:row.risk||null,
      confidence:finiteOrNull(row.confidence),
      setupScore:row.setup_score==null?null:Number(row.setup_score),
      executionScore:row.execution_score==null?null:Number(row.execution_score),
      safetyScore:row.safety_score==null?null:Number(row.safety_score),
      dataQualityScore:row.data_quality_score==null?null:Number(row.data_quality_score),
      marketState:row.market_state||null,
      riskFlagCount:row.risk_flag_count==null?null:Number(row.risk_flag_count),
      priceUsd:finiteOrNull(row.price_usd),
      marketCap:finiteOrNull(row.market_cap),
      liquidityUsd:finiteOrNull(row.liquidity_usd),
      volume24h:finiteOrNull(row.volume_24h),
      createdAt:row.created_at,
    }))

    return res.status(200).json({success:true,address,chain,count:rows.length,rows})
  }catch(error){
    return res.status(502).json({success:false,error:error?.message||'History service unavailable.'})
  }
}
