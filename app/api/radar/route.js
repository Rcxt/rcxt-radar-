import { NextResponse } from 'next/server'
import { getRadarCandidates } from '@/lib/dexscreener'
import { analyzePair } from '@/lib/intelligence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const pairs = await getRadarCandidates(8)

    const items = pairs
      .map((pair) => ({
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
      }))
      .sort((a, b) => b.intelligence.score - a.intelligence.score)

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      items,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Radar feed failed.' },
      { status: 500 },
    )
  }
}
