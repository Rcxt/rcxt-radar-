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

function getQuery(req,name,fallback=''){
  try{
    const url=new URL(req.url||'/','https://rcxt.local')
    return url.searchParams.get(name)??fallback
  }catch{
    return fallback
  }
}

async function callControl(req,{wallet,body=null}={}){
  const oidc=req.headers?.['x-vercel-oidc-token']
  const query=wallet?'?wallet='+encodeURIComponent(wallet):''
  const response=await fetch(SUPABASE_URL+'/functions/v1/rcxt-monitor-control'+query,{
    method:body?'POST':'GET',
    headers:{
      apikey:SUPABASE_PUBLISHABLE_KEY,
      'content-type':'application/json',
      ...(oidc?{'x-rcxt-vercel-oidc':oidc}:{}),
    },
    ...(body?{body:JSON.stringify(body)}:{}),
    cache:'no-store',
    signal:AbortSignal.timeout(8000),
  })
  let data=null
  try{data=await response.json()}catch{}
  if(!response.ok){
    const error=new Error(data?.error||'Monitor service unavailable')
    error.status=response.status
    throw error
  }
  return data
}

export default async function handler(req,res){
  const limited=rateLimit(req,{key:'monitor-control',limit:24,windowMs:60_000})
  applyRateHeaders(res,limited,24)
  if(!limited.allowed) return res.status(429).json({success:false,error:'Too many monitor requests.'})

  if(req.method==='GET'){
    const wallet=String(getQuery(req,'wallet')).trim()
    if(!addressPattern.test(wallet)) return res.status(400).json({success:false,error:'Invalid wallet address.'})
    try{
      const data=await callControl(req,{wallet})
      res.setHeader('Cache-Control','no-store')
      return res.status(200).json(data)
    }catch(error){
      return res.status(Number(error?.status)||502).json({success:false,error:error?.message||'Monitor unavailable.'})
    }
  }

  if(req.method!=='POST') return res.status(405).json({success:false,error:'Method not allowed'})

  let body=req.body
  if(typeof body==='string'){
    if(body.length>25_000) return res.status(413).json({success:false,error:'Request too large'})
    try{body=JSON.parse(body)}catch{return res.status(400).json({success:false,error:'Invalid JSON'})}
  }

  const wallet=String(body?.wallet||'').trim()
  const action=String(body?.action||'')
  if(!addressPattern.test(wallet)) return res.status(400).json({success:false,error:'Invalid wallet address.'})
  if(!['enable','disable','subscribe','unsubscribe'].includes(action)){
    return res.status(400).json({success:false,error:'Invalid monitor action.'})
  }

  if(action==='subscribe'){
    const endpoint=String(body?.subscription?.endpoint||'')
    const p256dh=String(body?.subscription?.keys?.p256dh||'')
    const auth=String(body?.subscription?.keys?.auth||'')
    if(!endpoint.startsWith('https://')||!p256dh||!auth){
      return res.status(400).json({success:false,error:'Invalid push subscription.'})
    }
  }

  try{
    const data=await callControl(req,{body:{...body,wallet,action}})
    res.setHeader('Cache-Control','no-store')
    return res.status(200).json(data)
  }catch(error){
    return res.status(Number(error?.status)||502).json({success:false,error:error?.message||'Monitor update failed.'})
  }
}
