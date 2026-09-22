import { getRadarCandidates } from '../lib/dexscreener.js'
import { analyzePair } from '../lib/intelligence.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success:false, error:'Method not allowed' })
  try {
    const pairs = await getRadarCandidates(8)
    const items = pairs.map((pair) => ({
      address: pair?.baseToken?.address,
      name: pair?.baseToken?.name || 'Unknown',
      symbol: pair?.baseToken?.symbol || 'UNKNOWN',
      priceUsd: Number(pair?.priceUsd || 0),
      marketCap: Number(pair?.marketCap || 0),
      liquidityUsd: Number(pair?.liquidity?.usd || 0),
      volume24h: Number(pair?.volume?.h24 || 0),
      change24h: Number(pair?.priceChange?.h24 || 0),
      dex: pair?.dexId || null,
      url: pair?.url || null,
      intelligence: analyzePair(pair, null),
    })).sort((a,b)=>b.intelligence.score-a.intelligence.score)
    return res.status(200).json({ success:true, generatedAt:new Date().toISOString(), items })
  } catch (error) {
    return res.status(500).json({ success:false, error:error?.message || 'Radar feed failed.' })
  }
}
