import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://vmiaajhjcdqtojpyicux.supabase.co'

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_55I4aMBK66DBjB3imBmoxg_gWKRz3Zv'

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({success:false,error:'Method not allowed'})

  const limited=rateLimit(req,{key:'calibration',limit:20,windowMs:60_000})
  applyRateHeaders(res,limited,20)
  if(!limited.allowed) return res.status(429).json({success:false,error:'Too many calibration requests.'})

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

    const totalSamples=rows.reduce((sum,row)=>sum+row.samples,0)
    const rawTotalSamples=rawRows.reduce((sum,row)=>sum+row.samples,0)
    return res.status(200).json({
      success:true,
      samplePolicy:data.samplePolicy||'clean-complete-components-with-timing-window',
      totalSamples,
      rawTotalSamples,
      rows,
      rawRows,
      buckets,
      components
    })
  }catch(error){
    return res.status(502).json({success:false,error:error?.message||'Calibration service unavailable.'})
  }
}
