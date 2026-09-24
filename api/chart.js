import { getChain } from '../lib/chains.js'
import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'
import { analyzeCandles } from '../lib/market-analytics.js'

const CACHE_TTL=12_000
const chartCache=new Map()
const INTERVALS={
  '1m':{timeframe:'minute',aggregate:1,minutes:1,limit:180},
  '5m':{timeframe:'minute',aggregate:5,minutes:5,limit:180},
  '15m':{timeframe:'minute',aggregate:15,minutes:15,limit:160},
  '1h':{timeframe:'hour',aggregate:1,minutes:60,limit:168},
}

function cacheGet(key){
  const item=chartCache.get(key)
  return item&&Date.now()-item.time<CACHE_TTL?item.value:null
}
function cacheSet(key,value){
  chartCache.set(key,{time:Date.now(),value})
  if(chartCache.size>120) chartCache.delete(chartCache.keys().next().value)
}

async function fetchCandles(pairAddress,interval,chain){
  const config=INTERVALS[interval]||INTERVALS['5m']
  const url=new URL(`https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(chain.geckoterminal)}/pools/${encodeURIComponent(pairAddress)}/ohlcv/${config.timeframe}`)
  url.searchParams.set('aggregate',String(config.aggregate))
  url.searchParams.set('limit',String(config.limit))
  url.searchParams.set('currency','usd')
  url.searchParams.set('token','base')

  const response=await fetch(url,{
    headers:{accept:'application/json','user-agent':'RCXT-Radar/6.1'},
    signal:AbortSignal.timeout(5000),
  })
  const text=await response.text()
  let data
  try{data=JSON.parse(text)}catch{data=null}
  if(!response.ok) throw new Error(data?.errors?.[0]?.detail||`Chart provider HTTP ${response.status}`)

  const rows=data?.data?.attributes?.ohlcv_list||[]
  const candles=rows.map((row)=>({
    timestamp:Number(row?.[0]||0),
    open:Number(row?.[1]||0),
    high:Number(row?.[2]||0),
    low:Number(row?.[3]||0),
    close:Number(row?.[4]||0),
    volume:Number(row?.[5]||0),
  })).filter((c)=>c.timestamp&&c.close>0).sort((a,b)=>a.timestamp-b.timestamp)

  return {candles,meta:data?.meta||null,config}
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

  const limited=rateLimit(req,{key:'chart',limit:40,windowMs:60_000})
  applyRateHeaders(res,limited,40)
  if(!limited.allowed) return res.status(429).json({success:false,error:'Too many chart requests. Try again shortly.'})

  const pairAddress=String(getQuery(req, 'pair')).trim()
  const interval=String(getQuery(req, 'interval', '5m'))
  const chain=getChain(String(getQuery(req,'chain','solana')).trim().toLowerCase())
  if(!chain) return res.status(400).json({success:false,error:'Unsupported chain.'})
  const validPair=chain.family==='evm'
    ? /^0x[a-fA-F0-9]{40}$/.test(pairAddress)
    : /^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(pairAddress)
  if(!validPair){
    return res.status(400).json({success:false,error:`Valid ${chain.label} pair address required.`})
  }
  if(!INTERVALS[interval]) return res.status(400).json({success:false,error:'Unsupported chart interval.'})

  const key=`${chain.id}:${pairAddress}:${interval}`
  const cached=cacheGet(key)
  if(cached){
    res.setHeader('X-RCXT-Cache','HIT')
    res.setHeader('Cache-Control','public, s-maxage=8, stale-while-revalidate=20')
    return res.status(200).json(cached)
  }

  try{
    const {candles,meta,config}=await fetchCandles(pairAddress,interval,chain)
    const analytics=analyzeCandles(candles,{intervalMinutes:config.minutes})
    const result={success:true,provider:'GeckoTerminal',chain:chain.id,pairAddress,interval,generatedAt:new Date().toISOString(),meta,count:candles.length,candles,analytics}
    cacheSet(key,result)
    res.setHeader('X-RCXT-Cache','MISS')
    res.setHeader('Cache-Control','public, s-maxage=8, stale-while-revalidate=20')
    return res.status(200).json(result)
  }catch(error){
    return res.status(502).json({success:false,error:error?.message||'Chart data unavailable.'})
  }
}
