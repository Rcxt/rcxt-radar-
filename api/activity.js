import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'
import { getPairsForTokens } from '../lib/dexscreener.js'
import {
  parseWalletTransaction,
  STABLE_MINTS,
  WRAPPED_SOL_MINT,
} from '../lib/wallet-activity.js'

const DEFAULT_RPC='https://api.mainnet-beta.solana.com'
const CACHE_TTL=8_000

function rpcEndpoints(){
  return [...new Set([
    ...(process.env.SOLANA_RPC_URLS||'').split(','),
    process.env.SOLANA_RPC_URL||'',
    DEFAULT_RPC,
  ].map(value=>String(value||'').trim()).filter(Boolean))]
}

function wait(ms){
  return new Promise(resolve=>setTimeout(resolve,ms))
}
const cache=new Map()
const addressPattern=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function finiteOrNull(value){
  if(value===null||value===undefined||value==='') return null
  const number=Number(value)
  return Number.isFinite(number)?number:null
}

function cached(key){
  const hit=cache.get(key)
  return hit&&Date.now()-hit.time<CACHE_TTL?hit.value:null
}

function setCache(key,value){
  cache.set(key,{time:Date.now(),value})
  if(cache.size>80) cache.delete(cache.keys().next().value)
}

async function rpc(body,timeout=5500){
  let lastError
  for(const endpoint of rpcEndpoints()){
    for(let attempt=0;attempt<2;attempt++){
      try{
        const response=await fetch(endpoint,{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify(body),
          signal:AbortSignal.timeout(timeout),
        })
        if(response.ok) return response.json()
        lastError=new Error('Solana RPC HTTP '+response.status)
        if(response.status!==429&&response.status<500) break
      }catch(error){
        lastError=error
      }
      if(attempt===0) await wait(160)
    }
  }
  throw lastError||new Error('Wallet activity RPC unavailable')
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

  const limited=rateLimit(req,{key:'wallet-activity',limit:18,windowMs:60_000})
  applyRateHeaders(res,limited,18)
  if(!limited.allowed) return res.status(429).json({success:false,error:'Too many wallet activity requests.'})

  const address=String(getQuery(req, 'address')).trim()
  const limit=Math.max(5,Math.min(20,Number(getQuery(req, 'limit', '12'))))
  if(!addressPattern.test(address)) return res.status(400).json({success:false,error:'Invalid Solana wallet address.'})

  const key=address+':'+limit
  const hit=cached(key)
  if(hit){
    res.setHeader('X-RCXT-Cache','HIT')
    res.setHeader('Cache-Control','private, max-age=5, stale-while-revalidate=8')
    return res.status(200).json(hit)
  }

  try{
    const sigResponse=await rpc({
      jsonrpc:'2.0',
      id:'rcxt-activity-signatures',
      method:'getSignaturesForAddress',
      params:[address,{limit}],
    })
    if(sigResponse?.error) throw new Error(sigResponse.error.message||'Signature lookup failed')

    const signatures=(sigResponse?.result||[]).map(row=>row.signature).filter(Boolean)
    if(!signatures.length){
      const empty={
        success:true,
        address,
        count:0,
        events:[],
        newBuys:[],
        generatedAt:new Date().toISOString(),
      }
      setCache(key,empty)
      return res.status(200).json(empty)
    }

    const batch=signatures.map((signature,index)=>({
      jsonrpc:'2.0',
      id:index+1,
      method:'getTransaction',
      params:[signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:0,commitment:'confirmed'}],
    }))

    const txResponse=await rpc(batch,8000)
    const txRows=Array.isArray(txResponse)?txResponse:[]
    const events=txRows
      .sort((a,b)=>Number(a.id||0)-Number(b.id||0))
      .map(row=>parseWalletTransaction(row?.result,address))
      .filter(Boolean)

    const mints=[...new Set(
      events
        .flatMap(event=>event.changes.map(change=>change.mint))
        .filter(mint=>!STABLE_MINTS.has(mint)&&mint!==WRAPPED_SOL_MINT)
    )]

    const pairs=await getPairsForTokens(mints)

    const enriched=events.map(event=>{
      const pair=event.primaryMint?pairs.get(event.primaryMint):null
      return {
        ...event,
        token:event.primaryMint?{
          address:event.primaryMint,
          symbol:pair?.baseToken?.symbol||null,
          name:pair?.baseToken?.name||null,
          priceUsd:finiteOrNull(pair?.priceUsd),
          marketCap:finiteOrNull(pair?.marketCap),
          fdv:finiteOrNull(pair?.fdv),
          liquidityUsd:finiteOrNull(pair?.liquidity?.usd),
          dex:pair?.dexId||null,
          pairAddress:pair?.pairAddress||null,
          url:pair?.url||null,
        }:null,
      }
    })

    const newBuys=enriched
      .filter(event=>event.type==='BUY'&&event.primaryMint)
      .slice(0,8)
      .map(event=>({
        signature:event.signature,
        blockTime:event.blockTime,
        solSpent:event.solDelta<0?Math.abs(event.solDelta):null,
        token:event.token,
        amountReceived:event.changes.find(change=>change.mint===event.primaryMint&&change.delta>0)?.delta||null,
      }))

    const countType=(type)=>enriched.filter(event=>event.type===type).length
    const buyEvents=enriched.filter(event=>event.type==='BUY')
    const sellEvents=enriched.filter(event=>event.type==='SELL')
    const classified=enriched.filter(event=>['BUY','SELL','SWAP','RECEIVE','SEND'].includes(event.type))
    const tradedMints=new Set(
      enriched
        .filter(event=>['BUY','SELL','SWAP'].includes(event.type))
        .flatMap(event=>event.changes.map(change=>change.mint))
        .filter(mint=>!STABLE_MINTS.has(mint)&&mint!==WRAPPED_SOL_MINT)
    )

    const summary={
      buyCount:countType('BUY'),
      sellCount:countType('SELL'),
      swapCount:countType('SWAP'),
      receiveCount:countType('RECEIVE'),
      sendCount:countType('SEND'),
      uniqueTradedMints:tradedMints.size,
      solSpentOnBuys:Number(
        buyEvents.reduce((sum,event)=>sum+(event.solDelta<0?Math.abs(event.solDelta):0),0).toFixed(6)
      ),
      solReceivedOnSells:Number(
        sellEvents.reduce((sum,event)=>sum+(event.solDelta>0?event.solDelta:0),0).toFixed(6)
      ),
      classificationCoveragePercent:enriched.length
        ? Number((classified.length/enriched.length*100).toFixed(1))
        : 0,
    }

    const result={
      success:true,
      address,
      count:enriched.length,
      generatedAt:new Date().toISOString(),
      summary,
      events:enriched,
      newBuys,
      classificationNote:'BUY/SELL require token balance change plus SOL/stablecoin flow. Transfers remain RECEIVE/SEND when trade evidence is insufficient.',
    }

    setCache(key,result)
    res.setHeader('X-RCXT-Cache','MISS')
    res.setHeader('Cache-Control','private, max-age=5, stale-while-revalidate=8')
    return res.status(200).json(result)
  }catch(error){
    return res.status(502).json({success:false,error:error?.message||'Wallet activity unavailable.'})
  }
}
