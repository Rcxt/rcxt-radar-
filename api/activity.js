import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'
import { getPairsForTokens } from '../lib/dexscreener.js'
import {
  parseWalletTransaction,
  STABLE_MINTS,
  WRAPPED_SOL_MINT,
} from '../lib/wallet-activity.js'

const RPC=process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const CACHE_TTL=20_000
const cache=new Map()
const addressPattern=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function cached(key){
  const hit=cache.get(key)
  return hit&&Date.now()-hit.time<CACHE_TTL?hit.value:null
}

function setCache(key,value){
  cache.set(key,{time:Date.now(),value})
  if(cache.size>80) cache.delete(cache.keys().next().value)
}

async function rpc(body,timeout=5500){
  const response=await fetch(RPC,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(timeout),
  })
  if(!response.ok) throw new Error('Solana RPC HTTP '+response.status)
  return response.json()
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({success:false,error:'Method not allowed'})

  const limited=rateLimit(req,{key:'wallet-activity',limit:18,windowMs:60_000})
  applyRateHeaders(res,limited,18)
  if(!limited.allowed) return res.status(429).json({success:false,error:'Too many wallet activity requests.'})

  const address=String(req.query?.address||'').trim()
  const limit=Math.max(5,Math.min(20,Number(req.query?.limit||12)))
  if(!addressPattern.test(address)) return res.status(400).json({success:false,error:'Invalid Solana wallet address.'})

  const key=address+':'+limit
  const hit=cached(key)
  if(hit){
    res.setHeader('X-RCXT-Cache','HIT')
    res.setHeader('Cache-Control','private, max-age=10, stale-while-revalidate=20')
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
          priceUsd:Number(pair?.priceUsd||0)||null,
          marketCap:Number(pair?.marketCap||pair?.fdv||0)||null,
          liquidityUsd:Number(pair?.liquidity?.usd||0)||null,
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

    const result={
      success:true,
      address,
      count:enriched.length,
      generatedAt:new Date().toISOString(),
      events:enriched,
      newBuys,
      classificationNote:'BUY/SELL require token balance change plus SOL/stablecoin flow. Transfers remain RECEIVE/SEND when trade evidence is insufficient.',
    }

    setCache(key,result)
    res.setHeader('X-RCXT-Cache','MISS')
    res.setHeader('Cache-Control','private, max-age=10, stale-while-revalidate=20')
    return res.status(200).json(result)
  }catch(error){
    return res.status(502).json({success:false,error:error?.message||'Wallet activity unavailable.'})
  }
}
