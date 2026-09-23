import { getRadarCandidates } from '../lib/dexscreener.js'
import { analyzePair, SCORE_VERSION } from '../lib/intelligence.js'
import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success:false, error:'Method not allowed' })

  const limited = rateLimit(req, { key:'radar', limit:45, windowMs:60_000 })
  applyRateHeaders(res, limited, 45)
  if (!limited.allowed) return res.status(429).json({ success:false, error:'Too many radar requests. Try again shortly.' })

  try {
    const pairs = await getRadarCandidates(24)
    const items = pairs.map((pair) => {
      const intelligence = analyzePair(pair, null)
      const createdAt = Number(pair?.pairCreatedAt || 0)
      const ageHours = createdAt ? Math.max(0, (Date.now() - createdAt) / 3_600_000) : null

      const buys5m = Number(pair?.txns?.m5?.buys || 0)
      const sells5m = Number(pair?.txns?.m5?.sells || 0)
      const tx5m = buys5m + sells5m
      const buys1h = Number(pair?.txns?.h1?.buys || 0)
      const sells1h = Number(pair?.txns?.h1?.sells || 0)
      const tx1h = buys1h + sells1h
      const buyPct5m = tx5m ? (buys5m / tx5m) * 100 : 50
      const buyPct1h = tx1h ? (buys1h / tx1h) * 100 : 50
      const liquidityReported = intelligence?.liquidityReported !== false
      const liquidityUsd = liquidityReported ? Number(pair?.liquidity?.usd || 0) : null
      const volume5m = Number(pair?.volume?.m5 || 0)
      const change5m = Number(pair?.priceChange?.m5 || 0)
      const change1h = Number(pair?.priceChange?.h1 || 0)

      const freshnessScore =
        ageHours === null ? 15 :
        ageHours <= 0.25 ? 100 :
        ageHours <= 0.5 ? 96 :
        ageHours <= 1 ? 90 :
        ageHours <= 3 ? 82 :
        ageHours <= 6 ? 70 :
        ageHours <= 12 ? 52 :
        ageHours <= 24 ? 32 : 10

      const flowScore =
        tx5m >= 120 ? 100 :
        tx5m >= 60 ? 88 :
        tx5m >= 25 ? 72 :
        tx5m >= 10 ? 56 :
        tx5m >= 4 ? 38 : 12

      const liquidityScore = !liquidityReported ? 45 :
        liquidityUsd >= 50000 ? 100 :
        liquidityUsd >= 20000 ? 84 :
        liquidityUsd >= 8000 ? 68 :
        liquidityUsd >= 3000 ? 50 : 18

      let trenchScore = Math.round(
        freshnessScore * 0.35 +
        flowScore * 0.28 +
        liquidityScore * 0.22 +
        Number(pair?.rcxtDiscovery?.score || 0) * 0.15
      )

      if (buyPct5m >= 52 && buyPct5m <= 72) trenchScore += 7
      if (buyPct1h >= 50 && buyPct1h <= 70) trenchScore += 4
      if (buyPct5m < 35 && tx5m >= 10) trenchScore -= 18
      if (buyPct1h < 38 && tx1h >= 20) trenchScore -= 24
      if (liquidityReported && liquidityUsd < 3000) trenchScore -= 18
      if (change5m > 35 || change1h > 120) trenchScore -= 14
      if (change5m < -15) trenchScore -= 12
      if (change5m < -20) trenchScore = Math.min(trenchScore, 55)
      if (change1h < -25) trenchScore = Math.min(trenchScore, 52)
      if (change5m < -35 || change1h < -45) trenchScore = Math.min(trenchScore, 42)
      trenchScore = Math.max(0, Math.min(100, trenchScore))

      if (buyPct1h < 35 && tx1h >= 50) trenchScore = Math.min(trenchScore, 68)
      if (buyPct5m < 30 && tx5m >= 20) trenchScore = Math.min(trenchScore, 55)

      const trenchState =
        (change5m < -35 || change1h < -45) ? 'DUMPING' :
        (liquidityReported && liquidityUsd < 3000) ? 'THIN' :
        (buyPct5m < 35 && tx5m >= 10) ? 'SELLERS' :
        (buyPct1h < 38 && tx1h >= 20 && buyPct5m >= 50) ? 'REVERSAL' :
        (buyPct1h < 38 && tx1h >= 20) ? 'SELLERS' :
        (change5m > 35 || change1h > 120) ? 'EXTENDED' :
        trenchScore >= 78 ? 'HOT' :
        trenchScore >= 62 ? 'ACTIVE' :
        trenchScore >= 45 ? 'WATCH' : 'QUIET'

      const address = pair?.baseToken?.address
      const pumpFunEligible =
        String(address || '').endsWith('pump') ||
        ['pumpfun','pumpswap'].includes(String(pair?.dexId || '').toLowerCase())

      return {
        address,
        name: pair?.baseToken?.name || 'Unknown',
        symbol: pair?.baseToken?.symbol || 'UNKNOWN',
        priceUsd: Number(pair?.priceUsd || 0),
        priceNative: Number(pair?.priceNative || 0),
        marketCap: Number(pair?.marketCap || 0),
        fdv: Number(pair?.fdv || 0),
        liquidityUsd,
        liquidityReported,
        liquiditySource:intelligence?.liquiditySource || null,
        volume5m,
        volume1h: Number(pair?.volume?.h1 || 0),
        volume6h: Number(pair?.volume?.h6 || 0),
        volume24h: Number(pair?.volume?.h24 || 0),
        change5m,
        change1h,
        change6h: Number(pair?.priceChange?.h6 || 0),
        change24h: Number(pair?.priceChange?.h24 || 0),
        buys5m,
        sells5m,
        tx5m,
        buyPct5m: Number(buyPct5m.toFixed(1)),
        buys1h,
        sells1h,
        tx1h,
        buyPct1h: Number(buyPct1h.toFixed(1)),
        buys24h: Number(pair?.txns?.h24?.buys || 0),
        sells24h: Number(pair?.txns?.h24?.sells || 0),
        ageHours: ageHours === null ? null : Number(ageHours.toFixed(1)),
        isNew: ageHours !== null && ageHours <= 24,
        freshnessBand:
          ageHours === null ? 'UNKNOWN' :
          ageHours <= 1 ? 'JUST LAUNCHED' :
          ageHours <= 6 ? 'VERY NEW' :
          ageHours <= 24 ? 'NEW' :
          ageHours <= 48 ? 'RECENT' : 'ESTABLISHED',
        discoveryScore: Number(pair?.rcxtDiscovery?.score || 0),
        discoverySources: pair?.rcxtDiscovery?.sourceTags || [],
        trenchScore,
        trenchState,
        pumpFunEligible,
        pumpFunUrl: pumpFunEligible ? `https://pump.fun/coin/${address}` : null,
        dex: pair?.dexId || null,
        pairAddress: pair?.pairAddress || null,
        url: pair?.url || null,
        intelligence,
      }
    }).sort((a,b)=>{
      const aRank = Number(a.intelligence.score || 0) * 0.72 + Number(a.discoveryScore || 0) * 0.28
      const bRank = Number(b.intelligence.score || 0) * 0.72 + Number(b.discoveryScore || 0) * 0.28
      return bRank - aRank
    })

    res.setHeader('Cache-Control','public, s-maxage=5, stale-while-revalidate=10')
    return res.status(200).json({
      success:true,
      modelVersion:SCORE_VERSION,
      generatedAt:new Date().toISOString(),
      count:items.length,
      items,
    })
  } catch (error) {
    return res.status(500).json({ success:false, error:error?.message || 'Radar feed failed.' })
  }
}
