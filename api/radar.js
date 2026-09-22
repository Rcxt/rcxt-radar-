import { getRadarCandidates } from '../lib/dexscreener.js'
import { analyzePair } from '../lib/intelligence.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success:false, error:'Method not allowed' })

  try {
    const pairs = await getRadarCandidates(18)
    const items = pairs.map((pair) => {
      const intelligence = analyzePair(pair, null)
      const createdAt = Number(pair?.pairCreatedAt || 0)
      const ageHours = createdAt ? Math.max(0, (Date.now() - createdAt) / 3_600_000) : null

      return {
        address: pair?.baseToken?.address,
        name: pair?.baseToken?.name || 'Unknown',
        symbol: pair?.baseToken?.symbol || 'UNKNOWN',
        priceUsd: Number(pair?.priceUsd || 0),
        priceNative: Number(pair?.priceNative || 0),
        marketCap: Number(pair?.marketCap || 0),
        fdv: Number(pair?.fdv || 0),
        liquidityUsd: Number(pair?.liquidity?.usd || 0),
        volume5m: Number(pair?.volume?.m5 || 0),
        volume1h: Number(pair?.volume?.h1 || 0),
        volume6h: Number(pair?.volume?.h6 || 0),
        volume24h: Number(pair?.volume?.h24 || 0),
        change5m: Number(pair?.priceChange?.m5 || 0),
        change1h: Number(pair?.priceChange?.h1 || 0),
        change6h: Number(pair?.priceChange?.h6 || 0),
        change24h: Number(pair?.priceChange?.h24 || 0),
        buys1h: Number(pair?.txns?.h1?.buys || 0),
        sells1h: Number(pair?.txns?.h1?.sells || 0),
        buys24h: Number(pair?.txns?.h24?.buys || 0),
        sells24h: Number(pair?.txns?.h24?.sells || 0),
        ageHours: ageHours === null ? null : Number(ageHours.toFixed(1)),
        dex: pair?.dexId || null,
        pairAddress: pair?.pairAddress || null,
        url: pair?.url || null,
        intelligence,
      }
    }).sort((a,b)=>b.intelligence.score-a.intelligence.score)

    return res.status(200).json({
      success:true,
      generatedAt:new Date().toISOString(),
      count:items.length,
      items,
    })
  } catch (error) {
    return res.status(500).json({ success:false, error:error?.message || 'Radar feed failed.' })
  }
}
