import { getSocialIntel } from '../lib/social-intel.js'
import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'
import { logSocialSnapshot } from '../lib/supabase-log.js'


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
  const limited=rateLimit(req,{key:'social',limit:20,windowMs:60_000})
  applyRateHeaders(res,limited,20)
  if(!limited.allowed) return res.status(429).json({success:false,error:'Too many social scans. Try again shortly.'})

  const address=String(getQuery(req, 'address')).trim()
  const symbol=String(getQuery(req, 'symbol')).trim().slice(0,32)
  const name=String(getQuery(req, 'name')).trim().slice(0,80)
  if(!address&&!symbol&&!name) return res.status(400).json({success:false,error:'Token identity is required for X search.'})

  const shouldPersist=String(getQuery(req, 'persist', '0'))==='1'

  try{
    const social=await getSocialIntel({address,symbol,name})
    const persistence=shouldPersist && social?.available
      ? await Promise.race([
          logSocialSnapshot({address,symbol,social}, req.headers?.['x-vercel-oidc-token']),
          new Promise(resolve=>setTimeout(()=>resolve({ok:false,status:0,error:'Persistence timeout'}),1800))
        ])
      : {ok:true,skipped:true,status:0,error:null}

    res.setHeader('Cache-Control','public, s-maxage=55, stale-while-revalidate=90')
    return res.status(200).json({success:true,engine:'5.0.0-x',scannedAt:new Date().toISOString(),persistence,social})
  }catch(error){
    return res.status(500).json({success:false,error:error?.message||'X social scan failed.'})
  }
}
