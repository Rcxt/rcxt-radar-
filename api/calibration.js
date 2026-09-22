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

    const rows=(data.rows||[]).map(row=>({
      scoreVersion:row.score_version,
      signal:row.signal,
      horizon:row.horizon,
      samples:Number(row.samples||0),
      avgReturnPct:row.avg_return_pct==null?null:Number(row.avg_return_pct),
      directionalHitRate:row.directional_hit_rate==null?null:Number(row.directional_hit_rate),
      avgDelayMinutes:row.avg_delay_minutes==null?null:Number(row.avg_delay_minutes),
    }))

    const totalSamples=rows.reduce((sum,row)=>sum+row.samples,0)
    return res.status(200).json({success:true,totalSamples,rows})
  }catch(error){
    return res.status(502).json({success:false,error:error?.message||'Calibration service unavailable.'})
  }
}
