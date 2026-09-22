import { getSocialIntel } from '../lib/social-intel.js'
import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({success:false,error:'Method not allowed'})
  const limited=rateLimit(req,{key:'social',limit:20,windowMs:60_000})
  applyRateHeaders(res,limited,20)
  if(!limited.allowed) return res.status(429).json({success:false,error:'Too many social scans. Try again shortly.'})

  const address=String(req.query?.address||'').trim()
  const symbol=String(req.query?.symbol||'').trim().slice(0,32)
  const name=String(req.query?.name||'').trim().slice(0,80)
  if(!address&&!symbol&&!name) return res.status(400).json({success:false,error:'Token identity is required.'})

  try{
    const social=await getSocialIntel({address,symbol,name})
    res.setHeader('Cache-Control','public, s-maxage=30, stale-while-revalidate=60')
    return res.status(200).json({success:true,scannedAt:new Date().toISOString(),social})
  }catch(error){
    return res.status(500).json({success:false,error:error?.message||'Social scan failed.'})
  }
}
