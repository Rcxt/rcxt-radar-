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

  const limited=rateLimit(req,{key:'trades',limit:30,windowMs:60_000})
  applyRateHeaders(res,limited,30)
  if(!limited.allowed) return res.status(429).json({success:false,error:'Too many trade-tape requests.'})

  const pair=String(getQuery(req, 'pair')).trim()
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
    const walletStats=new Map()
    for(const trade of trades){
      if(!trade.wallet) continue
      const current=walletStats.get(trade.wallet)||{count:0,volume:0,buyVolume:0,sellVolume:0,buyCount:0,sellCount:0}
      current.count+=1
      current.volume+=trade.volumeUsd
      if(trade.kind==='buy'){
        current.buyVolume+=trade.volumeUsd
        current.buyCount+=1
      }else{
        current.sellVolume+=trade.volumeUsd
        current.sellCount+=1
      }
      walletStats.set(trade.wallet,current)
    }
    const wallets=new Set(walletStats.keys())
    const walletRows=[...walletStats.entries()].map(([wallet,stats])=>({wallet,...stats}))
    const topWalletByCount=walletRows.reduce((best,row)=>row.count>(best?.count||0)?row:best,null)
    const topWalletByVolume=walletRows.reduce((best,row)=>row.volume>(best?.volume||0)?row:best,null)
    const microTrades=trades.filter(trade=>trade.volumeUsd<1)
    const tinyTrades=trades.filter(trade=>trade.volumeUsd<5)
    const repeatWalletTrades=walletRows.filter(row=>row.count>=5).reduce((sum,row)=>sum+row.count,0)
    const avgToMedianSkew=medianSize>0?(totalVolume/Math.max(1,trades.length))/medianSize:0

    const whaleWalletThreshold=Math.max(
      whaleThreshold,
      totalVolume>0?totalVolume*0.025:0,
      750
    )
    const whaleWallets=walletRows
      .map((row)=>{
        const netFlow=row.buyVolume-row.sellVolume
        const volumeShare=totalVolume>0?row.volume/totalVolume*100:0
        const direction=
          netFlow>Math.max(100,row.volume*0.2)?'ACCUMULATING':
          netFlow<-Math.max(100,row.volume*0.2)?'DISTRIBUTING':'MIXED'
        return {
          wallet:row.wallet,
          tradeCount:row.count,
          buyCount:row.buyCount,
          sellCount:row.sellCount,
          buyVolumeUsd:Number(row.buyVolume.toFixed(2)),
          sellVolumeUsd:Number(row.sellVolume.toFixed(2)),
          totalVolumeUsd:Number(row.volume.toFixed(2)),
          netFlowUsd:Number(netFlow.toFixed(2)),
          volumeSharePercent:Number(volumeShare.toFixed(1)),
          direction,
          explorerUrl:'https://solscan.io/account/'+row.wallet,
        }
      })
      .filter((row)=>row.totalVolumeUsd>=whaleWalletThreshold||row.volumeSharePercent>=5)
      .sort((a,b)=>b.totalVolumeUsd-a.totalVolumeUsd)
      .slice(0,10)

    const whaleWalletBuyVolume=whaleWallets.reduce((sum,row)=>sum+row.buyVolumeUsd,0)
    const whaleWalletSellVolume=whaleWallets.reduce((sum,row)=>sum+row.sellVolumeUsd,0)
    const whaleWalletNetFlow=whaleWalletBuyVolume-whaleWalletSellVolume
    const accumulatingWhales=whaleWallets.filter(row=>row.direction==='ACCUMULATING').length
    const distributingWhales=whaleWallets.filter(row=>row.direction==='DISTRIBUTING').length

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
      microTradePercent:trades.length?Number((microTrades.length/trades.length*100).toFixed(1)):0,
      tinyTradePercent:trades.length?Number((tinyTrades.length/trades.length*100).toFixed(1)):0,
      repeatWalletTradePercent:trades.length?Number((repeatWalletTrades/trades.length*100).toFixed(1)):0,
      topWalletTradeSharePercent:trades.length&&topWalletByCount?Number((topWalletByCount.count/trades.length*100).toFixed(1)):0,
      topWalletVolumeSharePercent:totalVolume&&topWalletByVolume?Number((topWalletByVolume.volume/totalVolume*100).toFixed(1)):0,
      averageToMedianSizeRatio:Number(avgToMedianSkew.toFixed(1)),
      whaleThresholdUsd:Number(whaleThreshold.toFixed(2)),
      whaleBuyCount:whaleBuys.length,
      whaleSellCount:whaleSells.length,
      whaleBuyVolumeUsd:Number(whaleBuys.reduce((sum,trade)=>sum+trade.volumeUsd,0).toFixed(2)),
      whaleSellVolumeUsd:Number(whaleSells.reduce((sum,trade)=>sum+trade.volumeUsd,0).toFixed(2)),
      whaleWalletThresholdUsd:Number(whaleWalletThreshold.toFixed(2)),
      whaleWalletCount:whaleWallets.length,
      accumulatingWhales,
      distributingWhales,
      whaleWalletBuyVolumeUsd:Number(whaleWalletBuyVolume.toFixed(2)),
      whaleWalletSellVolumeUsd:Number(whaleWalletSellVolume.toFixed(2)),
      whaleWalletNetFlowUsd:Number(whaleWalletNetFlow.toFixed(2)),
      topWhaleVolumeSharePercent:whaleWallets[0]?.volumeSharePercent||0,
      topTradeSharePercent:totalVolume?Number((largestTrade/totalVolume*100).toFixed(1)):0,
    }

    const flags=[]
    if(summary.buyVolumePercent>=68&&summary.sampleSize>=15) flags.push('BUY_VOLUME_DOMINANT')
    if(summary.buyVolumePercent<=32&&summary.sampleSize>=15) flags.push('SELL_VOLUME_DOMINANT')
    if(summary.whaleSellVolumeUsd>summary.whaleBuyVolumeUsd*1.5&&summary.whaleSellCount) flags.push('WHALE_SELL_PRESSURE')
    if(summary.whaleBuyVolumeUsd>summary.whaleSellVolumeUsd*1.5&&summary.whaleBuyCount) flags.push('WHALE_BUY_PRESSURE')
    if(summary.topTradeSharePercent>=35) flags.push('TOP_TRADE_CONCENTRATED')
    if(summary.uniqueWallets<=5&&summary.sampleSize>=15) flags.push('LOW_WALLET_DIVERSITY')
    if(summary.microTradePercent>=60&&summary.sampleSize>=30) flags.push('MICROTRADE_NOISE')
    if(summary.repeatWalletTradePercent>=55&&summary.sampleSize>=30) flags.push('REPEAT_WALLET_CHURN')
    if(summary.topWalletTradeSharePercent>=25&&summary.sampleSize>=30) flags.push('WALLET_ACTIVITY_CONCENTRATION')
    if(summary.topWalletVolumeSharePercent>=45&&summary.sampleSize>=15) flags.push('WALLET_VOLUME_CONCENTRATION')
    if(summary.averageToMedianSizeRatio>=20&&summary.sampleSize>=30) flags.push('TRADE_SIZE_SKEW')
    if(summary.whaleWalletNetFlowUsd>Math.max(1000,totalVolume*0.12)&&summary.accumulatingWhales>=2) flags.push('MULTI_WHALE_ACCUMULATION')
    if(summary.whaleWalletNetFlowUsd<-Math.max(1000,totalVolume*0.12)&&summary.distributingWhales>=2) flags.push('MULTI_WHALE_DISTRIBUTION')
    if(summary.topWhaleVolumeSharePercent>=35&&summary.whaleWalletCount) flags.push('WHALE_FLOW_CONCENTRATED')

    const result={
      success:true,
      provider:'GeckoTerminal',
      pairAddress:pair,
      generatedAt:new Date().toISOString(),
      summary:{...summary,flags},
      whaleWallets,
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
