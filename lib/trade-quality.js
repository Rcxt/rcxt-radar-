const CACHE_TTL_MS=20_000
const cache=new Map()

function finite(value){
  const n=Number(value)
  return Number.isFinite(n)?n:0
}

function median(values){
  const rows=values.filter(Number.isFinite).sort((a,b)=>a-b)
  if(!rows.length) return 0
  const mid=Math.floor(rows.length/2)
  return rows.length%2?rows[mid]:(rows[mid-1]+rows[mid])/2
}

export function analyzeTradeQuality(trades=[]){
  const rows=(Array.isArray(trades)?trades:[])
    .map((trade)=>({
      kind:String(trade?.kind||'').toLowerCase(),
      volumeUsd:Math.max(0,finite(trade?.volumeUsd)),
      wallet:trade?.wallet?String(trade.wallet):null,
    }))
    .filter((trade)=>['buy','sell'].includes(trade.kind))

  const sampleSize=rows.length
  const sizes=rows.map((row)=>row.volumeUsd)
  const totalVolume=sizes.reduce((sum,value)=>sum+value,0)
  const medianTradeUsd=median(sizes)
  const averageTradeUsd=sampleSize?totalVolume/sampleSize:0
  const wallets=new Map()

  for(const trade of rows){
    if(!trade.wallet) continue
    const current=wallets.get(trade.wallet)||{count:0,volume:0}
    current.count+=1
    current.volume+=trade.volumeUsd
    wallets.set(trade.wallet,current)
  }

  const walletRows=[...wallets.values()]
  const topCount=walletRows.reduce((max,row)=>Math.max(max,row.count),0)
  const topVolume=walletRows.reduce((max,row)=>Math.max(max,row.volume),0)
  const microTrades=rows.filter((row)=>row.volumeUsd<1).length
  const repeatWalletTrades=walletRows
    .filter((row)=>row.count>=5)
    .reduce((sum,row)=>sum+row.count,0)
  const largestTrade=sizes.reduce((max,value)=>Math.max(max,value),0)

  const summary={
    sampleSize,
    uniqueWallets:wallets.size,
    microTradePercent:sampleSize?microTrades/sampleSize*100:0,
    repeatWalletTradePercent:sampleSize?repeatWalletTrades/sampleSize*100:0,
    topWalletTradeSharePercent:sampleSize?topCount/sampleSize*100:0,
    topWalletVolumeSharePercent:totalVolume?topVolume/totalVolume*100:0,
    averageToMedianSizeRatio:medianTradeUsd>0?averageTradeUsd/medianTradeUsd:0,
    topTradeSharePercent:totalVolume?largestTrade/totalVolume*100:0,
  }

  const flags=[]
  let manipulationRiskScore=0

  if(sampleSize>=15&&summary.uniqueWallets<=5){
    flags.push('LOW_WALLET_DIVERSITY')
    manipulationRiskScore+=25
  }
  if(sampleSize>=30&&summary.microTradePercent>=60){
    flags.push('MICROTRADE_NOISE')
    manipulationRiskScore+=18
  }
  if(sampleSize>=30&&summary.repeatWalletTradePercent>=55){
    flags.push('REPEAT_WALLET_CHURN')
    manipulationRiskScore+=24
  }
  if(sampleSize>=30&&summary.topWalletTradeSharePercent>=25){
    flags.push('WALLET_ACTIVITY_CONCENTRATION')
    manipulationRiskScore+=15
  }
  if(sampleSize>=15&&summary.topWalletVolumeSharePercent>=45){
    flags.push('WALLET_VOLUME_CONCENTRATION')
    manipulationRiskScore+=14
  }
  if(sampleSize>=30&&summary.averageToMedianSizeRatio>=20){
    flags.push('TRADE_SIZE_SKEW')
    manipulationRiskScore+=8
  }
  if(sampleSize>=15&&summary.topTradeSharePercent>=35){
    flags.push('TOP_TRADE_CONCENTRATED')
    manipulationRiskScore+=6
  }

  manipulationRiskScore=Math.min(100,Math.round(manipulationRiskScore))
  const sampleQuality=
    sampleSize>=50&&wallets.size>=15?'STRONG':
    sampleSize>=30&&wallets.size>=8?'USABLE':
    sampleSize>=15?'LIMITED':'INSUFFICIENT'

  return {
    available:sampleSize>0,
    sampleQuality,
    manipulationRiskScore,
    activityQualityScore:Math.max(0,100-manipulationRiskScore),
    flags,
    summary:Object.fromEntries(
      Object.entries(summary).map(([key,value])=>[
        key,
        typeof value==='number'?Number(value.toFixed(2)):value,
      ])
    ),
  }
}

function normalizeGeckoTrades(data){
  return (Array.isArray(data?.data)?data.data:[])
    .map((item)=>{
      const a=item?.attributes||{}
      return {
        kind:String(a.kind||'').toLowerCase(),
        volumeUsd:Number(a.volume_in_usd||0),
        wallet:a.tx_from_address||null,
      }
    })
}

export async function getTradeQuality(pairAddress,chain){
  if(!pairAddress||!chain?.geckoterminal){
    return {available:false,reason:'NO_PAIR'}
  }

  const key=`${chain.id}:${String(pairAddress).toLowerCase()}`
  const cached=cache.get(key)
  if(cached&&Date.now()-cached.time<CACHE_TTL_MS) return cached.value

  try{
    const response=await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(chain.geckoterminal)}/pools/${encodeURIComponent(pairAddress)}/trades`,
      {
        headers:{
          accept:'application/json;version=20230203',
          'user-agent':'RCXT-Radar/6.1',
        },
        cache:'no-store',
        signal:AbortSignal.timeout(4200),
      },
    )
    if(!response.ok) throw new Error(`HTTP ${response.status}`)
    const data=await response.json()
    const value={
      ...analyzeTradeQuality(normalizeGeckoTrades(data)),
      source:'geckoterminal-trades',
      fetchedAt:new Date().toISOString(),
    }
    cache.set(key,{time:Date.now(),value})
    return value
  }catch(error){
    return {
      available:false,
      source:'geckoterminal-trades',
      reason:String(error?.message||'Trade quality unavailable').slice(0,120),
    }
  }
}
