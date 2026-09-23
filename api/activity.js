import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'
import { getPairsForTokens } from '../lib/dexscreener.js'

const RPC=process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const CACHE_TTL=20_000
const cache=new Map()
const addressPattern=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const USDC='EPjFWdd5AufqSSqeM2q9kwWBK6GfYxkKc8uYNxgXzV'
const USDT='Es9vMFrzaCERmJfrF4H2FYD9Wg9kNnYFhXqGqKqMGV'
const WSOL='So11111111111111111111111111111111111111112'
const stableMints=new Set([USDC,USDT])

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

function pubkeyValue(key){
  if(typeof key==='string') return key
  return key?.pubkey || key?.pubKey || null
}

function tokenAmount(balance){
  const value=balance?.uiTokenAmount?.uiAmountString ?? balance?.uiTokenAmount?.uiAmount ?? '0'
  const n=Number(value)
  return Number.isFinite(n)?n:0
}

function ownedBalances(list,address){
  const out=new Map()
  for(const row of list||[]){
    if(row?.owner && row.owner!==address) continue
    if(!row?.mint) continue
    out.set(row.mint,{
      mint:row.mint,
      amount:tokenAmount(row),
      decimals:Number(row?.uiTokenAmount?.decimals||0),
    })
  }
  return out
}

function classify(changes,solDelta){
  const meaningful=changes.filter(change=>Math.abs(change.delta)>0)
  const gained=meaningful.filter(change=>change.delta>0)
  const lost=meaningful.filter(change=>change.delta<0)
  const gainedStable=gained.some(change=>stableMints.has(change.mint))
  const lostStable=lost.some(change=>stableMints.has(change.mint))
  const gainedTrade=gained.some(change=>!stableMints.has(change.mint)&&change.mint!==WSOL)
  const lostTrade=lost.some(change=>!stableMints.has(change.mint)&&change.mint!==WSOL)

  if(gainedTrade && (lostStable || solDelta < -0.00005)) return 'BUY'
  if(lostTrade && (gainedStable || solDelta > 0.00005)) return 'SELL'
  if(gained.length && lost.length) return 'SWAP'
  if(gained.length) return 'RECEIVE'
  if(lost.length) return 'SEND'
  return 'OTHER'
}

function primaryMint(changes,type){
  const candidates=changes.filter(change=>{
    if(stableMints.has(change.mint)||change.mint===WSOL) return false
    if(type==='BUY'||type==='RECEIVE') return change.delta>0
    if(type==='SELL'||type==='SEND') return change.delta<0
    return true
  })
  return candidates.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta))[0]?.mint || null
}

function parseTransaction(tx,address){
  if(!tx?.meta||!tx?.transaction?.message) return null
  const keys=(tx.transaction.message.accountKeys||[]).map(pubkeyValue)
  const walletIndex=keys.indexOf(address)
  const preSol=walletIndex>=0?Number(tx.meta.preBalances?.[walletIndex]||0):0
  const postSol=walletIndex>=0?Number(tx.meta.postBalances?.[walletIndex]||0):0
  let solDelta=(postSol-preSol)/1e9
  if(walletIndex===0 && Number(tx.meta.fee||0)>0) solDelta+=Number(tx.meta.fee)/1e9

  const pre=ownedBalances(tx.meta.preTokenBalances,address)
  const post=ownedBalances(tx.meta.postTokenBalances,address)
  const mints=new Set([...pre.keys(),...post.keys()])
  const changes=[]
  for(const mint of mints){
    const before=pre.get(mint)?.amount||0
    const after=post.get(mint)?.amount||0
    const delta=after-before
    if(Math.abs(delta)<1e-12) continue
    changes.push({
      mint,
      before,
      after,
      delta,
      decimals:post.get(mint)?.decimals??pre.get(mint)?.decimals??0,
    })
  }

  if(!changes.length) return null
  const type=classify(changes,solDelta)
  const mint=primaryMint(changes,type)

  return {
    signature:tx.transaction.signatures?.[0]||null,
    blockTime:tx.blockTime?new Date(tx.blockTime*1000).toISOString():null,
    slot:tx.slot||null,
    type,
    primaryMint:mint,
    solDelta:Number(solDelta.toFixed(9)),
    feeSol:Number((Number(tx.meta.fee||0)/1e9).toFixed(9)),
    changes,
    failed:Boolean(tx.meta.err),
  }
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
      const empty={success:true,address,count:0,events:[],newBuys:[],generatedAt:new Date().toISOString()}
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
      .map(row=>parseTransaction(row?.result,address))
      .filter(Boolean)

    const mints=[...new Set(events.flatMap(event=>event.changes.map(change=>change.mint)).filter(mint=>!stableMints.has(mint)&&mint!==WSOL))]
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
