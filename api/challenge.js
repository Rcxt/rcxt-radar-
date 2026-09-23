import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://vmiaajhjcdqtojpyicux.supabase.co'

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_55I4aMBK66DBjB3imBmoxg_gWKRz3Zv'

const addressPattern=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/


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

  const limited=rateLimit(req,{key:'challenge',limit:25,windowMs:60_000})
  applyRateHeaders(res,limited,25)
  if(!limited.allowed) return res.status(429).json({success:false,error:'Too many challenge requests.'})

  const address=String(getQuery(req, 'address')).trim()
  if(!addressPattern.test(address)) return res.status(400).json({success:false,error:'Invalid Solana wallet address.'})

  try{
    const response=await fetch(
      `${SUPABASE_URL}/functions/v1/rcxt-log?wallet=${encodeURIComponent(address)}&limit=200`,
      {
        headers:{apikey:SUPABASE_PUBLISHABLE_KEY},
        cache:'no-store',
        signal:AbortSignal.timeout(3500),
      }
    )
    const data=await response.json()
    if(!response.ok||!data?.ok) throw new Error(data?.error||'Challenge history unavailable')

    const rows=(data.rows||[]).map((row)=>({
      totalValueUsd:Number(row.total_value_usd||0),
      solValueUsd:Number(row.sol_value_usd||0),
      tokenValueUsd:Number(row.token_value_usd||0),
      solBalance:Number(row.sol_balance||0),
      tokenCount:Number(row.token_count||0),
      createdAt:row.created_at,
    })).filter((row)=>row.totalValueUsd>=0)

    const values=rows.map((row)=>row.totalValueUsd).filter(Number.isFinite)
    const highWater=values.length?Math.max(...values):0
    const lowWater=values.length?Math.min(...values):0
    const latest=rows.at(-1)||null
    const first=rows[0]||null
    const drawdown=highWater>0&&latest
      ? ((latest.totalValueUsd/highWater)-1)*100
      : 0

    let rollingPeak=0
    let maxDrawdown=0
    for(const value of values){
      rollingPeak=Math.max(rollingPeak,value)
      if(rollingPeak>0) maxDrawdown=Math.min(maxDrawdown,((value/rollingPeak)-1)*100)
    }

    const changeSinceStart=first&&latest&&first.totalValueUsd>0
      ? ((latest.totalValueUsd/first.totalValueUsd)-1)*100
      : null

    const cutoff24h=Date.now()-24*60*60*1000
    const row24h=[...rows].reverse().find((row)=>new Date(row.createdAt).getTime()<=cutoff24h)
    const change24h=row24h&&latest&&row24h.totalValueUsd>0
      ? ((latest.totalValueUsd/row24h.totalValueUsd)-1)*100
      : null

    const returns=[]
    for(let i=1;i<values.length;i+=1){
      if(values[i-1]>0) returns.push(((values[i]/values[i-1])-1)*100)
    }
    const meanReturn=returns.length?returns.reduce((sum,value)=>sum+value,0)/returns.length:0
    const variance=returns.length>1
      ? returns.reduce((sum,value)=>sum+(value-meanReturn)**2,0)/(returns.length-1)
      : 0
    const equityVolatility=Math.sqrt(Math.max(0,variance))
    const recoveryPercent=latest&&latest.totalValueUsd>0&&highWater>latest.totalValueUsd
      ? ((highWater/latest.totalValueUsd)-1)*100
      : 0

    return res.status(200).json({
      success:true,
      address,
      count:rows.length,
      highWater,
      lowWater,
      drawdown:Number(drawdown.toFixed(2)),
      maxDrawdown:Number(maxDrawdown.toFixed(2)),
      changeSinceStart:changeSinceStart==null?null:Number(changeSinceStart.toFixed(2)),
      change24h:change24h==null?null:Number(change24h.toFixed(2)),
      equityVolatility:Number(equityVolatility.toFixed(2)),
      recoveryPercent:Number(recoveryPercent.toFixed(2)),
      first,
      latest,
      rows,
    })
  }catch(error){
    return res.status(502).json({success:false,error:error?.message||'Challenge history unavailable.'})
  }
}
