import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'

const CACHE_TTL=20_000
const cache=new Map()

function median(values){
  const nums=values.filter(Number.isFinite).sort((a,b)=>a-b)
  if(!nums.length) return 0
  const mid=Math.floor(nums.length/2)
  return nums.length%2?nums[mid]:(nums[mid-1]+nums[mid])/2
}

function getCached(key){
  const item=cache.get(key)
  return item&&Date.now()-item.time<CACHE_TTL?item.value:null
}

function setCached(key,value){
  cache.set(key,{time:Date.now(),value})
  if(cache.size>100) cache.delete(cache.keys().next().value)
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({success:false,error:'Method not allowed'})

  const limited=rateLimit(req,{key:'trades',limit:30,windowMs:60_000})
  applyRateHeaders(res,limited,30)
  if(!limited.allowed) return res.status(429).json({success:false,error:'Too many trade-tape requests.'})

  const pair=String(req.query?.pair||'').trim()
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(pair)){
    return res.status(400).json({success:false,error:'Valid Solana pair address required.'})
  }

  const hit=getCached(pair)
  if(hit){
    res.setHeader('X-RCXT-Cache','HIT')
    res.setHeader('Cache-Control','public, s-maxage=12, stale-while-revalidate=30')
    return res.status(200).json(hit)
  }

  try{
    const url='https://api.geckoterminal.com/api/v2/networks/solana/pools/'+encodeURIComponent(pair)+'/trades'
    const response=await fetch(url,{
      headers:{
        accept:'application/json;version=20230203',
        'user-agent':'RCXT-Radar/4.0',
      },
      signal:AbortSignal.timeout(5000),
    })
    const text=await response.text()
    let data
    try{data=JSON.parse(text)}catch{data=null}
    if(!response.ok) throw new Error(data?.errors?.[0]?.detail||'Trade provider HTTP '+response.status)

    const trades=(data?.data||[]).map(item=>{
      const a=item?.attributes||{}
      return {
        id:item?.id||a.tx_hash,
        kind:String(a.kind||'').toLowerCase(),
        volumeUsd:Number(a.volume_in_usd||0),
        wallet:a.tx_from_address||null,
        timestamp:a.block_timestamp||null,
        txHash:a.tx_hash||null,
      }
    }).filter(trade=>['buy','sell'].includes(trade.kind)&&trade.volumeUsd>=0)

    const buys=trades.filter(trade=>trade.kind==='buy')
    const sells=trades.filter(trade=>trade.kind==='sell')
    const buyVolume=buys.reduce((sum,trade)=>sum+trade.volumeUsd,0)
    const sellVolume=sells.reduce((sum,trade)=>sum+trade.volumeUsd,0)
    const totalVolume=buyVolume+sellVolume
    const sizes=trades.map(trade=>trade.volumeUsd)
    const medianSize=median(sizes)
    const whaleThreshold=Math.max(500,medianSize*5)
    const whaleBuys=buys.filter(trade=>trade.volumeUsd>=whaleThreshold)
    const whaleSells=sells.filter(trade=>trade.volumeUsd>=whaleThreshold)
    const largestBuy=buys.reduce((max,trade)=>Math.max(max,trade.volumeUsd),0)
    const largestSell=sells.reduce((max,trade)=>Math.max(max,trade.volumeUsd),0)
    const largestTrade=Math.max(largestBuy,largestSell)
    const wallets=new Set(trades.map(trade=>trade.wallet).filter(Boolean))

    const summary={
      sampleSize:trades.length,
      buyCount:buys.length,
      sellCount:sells.length,
      buyVolumeUsd:Number(buyVolume.toFixed(2)),
      sellVolumeUsd:Number(sellVolume.toFixed(2)),
      netFlowUsd:Number((buyVolume-sellVolume).toFixed(2)),
      buyVolumePercent:totalVolume?Number((buyVolume/totalVolume*100).toFixed(1)):50,
      averageTradeUsd:trades.length?Number((totalVolume/trades.length).toFixed(2)):0,
      medianTradeUsd:Number(medianSize.toFixed(2)),
      largestBuyUsd:Number(largestBuy.toFixed(2)),
      largestSellUsd:Number(largestSell.toFixed(2)),
      uniqueWallets:wallets.size,
      whaleThresholdUsd:Number(whaleThreshold.toFixed(2)),
      whaleBuyCount:whaleBuys.length,
      whaleSellCount:whaleSells.length,
      whaleBuyVolumeUsd:Number(whaleBuys.reduce((sum,trade)=>sum+trade.volumeUsd,0).toFixed(2)),
      whaleSellVolumeUsd:Number(whaleSells.reduce((sum,trade)=>sum+trade.volumeUsd,0).toFixed(2)),
      topTradeSharePercent:totalVolume?Number((largestTrade/totalVolume*100).toFixed(1)):0,
    }

    const flags=[]
    if(summary.buyVolumePercent>=68&&summary.sampleSize>=15) flags.push('BUY_VOLUME_DOMINANT')
    if(summary.buyVolumePercent<=32&&summary.sampleSize>=15) flags.push('SELL_VOLUME_DOMINANT')
    if(summary.whaleSellVolumeUsd>summary.whaleBuyVolumeUsd*1.5&&summary.whaleSellCount) flags.push('WHALE_SELL_PRESSURE')
    if(summary.whaleBuyVolumeUsd>summary.whaleSellVolumeUsd*1.5&&summary.whaleBuyCount) flags.push('WHALE_BUY_PRESSURE')
    if(summary.topTradeSharePercent>=35) flags.push('TOP_TRADE_CONCENTRATED')
    if(summary.uniqueWallets<=5&&summary.sampleSize>=15) flags.push('LOW_WALLET_DIVERSITY')

    const result={
      success:true,
      provider:'GeckoTerminal',
      pairAddress:pair,
      generatedAt:new Date().toISOString(),
      summary:{...summary,flags},
      trades:trades.slice(0,35),
    }
    setCached(pair,result)
    res.setHeader('X-RCXT-Cache','MISS')
    res.setHeader('Cache-Control','public, s-maxage=12, stale-while-revalidate=30')
    return res.status(200).json(result)
  }catch(error){
    return res.status(502).json({success:false,error:error?.message||'Trade tape unavailable.'})
  }
}
