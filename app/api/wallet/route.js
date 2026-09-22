import { NextResponse } from 'next/server'
import { getPairsForTokens } from '@/lib/dexscreener'
import { analyzePair } from '@/lib/intelligence'
import { getWalletSnapshot, looksLikeSolanaAddress } from '@/lib/solana'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const address = request.nextUrl.searchParams.get('address')?.trim()

  if (!looksLikeSolanaAddress(address)) {
    return NextResponse.json(
      { success: false, error: 'Enter a valid Solana wallet address.' },
      { status: 400 },
    )
  }

  try {
    const snapshot = await getWalletSnapshot(address)
    const pairs = await getPairsForTokens(snapshot.holdings.map((item) => item.mint))

    let portfolioTokenValueUsd = 0

    const holdings = snapshot.holdings
      .map((holding) => {
        const pair = pairs.get(holding.mint)
        const priceUsd = Number(pair?.priceUsd || 0)
        const valueUsd = holding.balance * priceUsd
        const intelligence = pair ? analyzePair(pair, null) : null

        portfolioTokenValueUsd += valueUsd

        return {
          mint: holding.mint,
          balance: holding.balance,
          name: pair?.baseToken?.name || null,
          symbol: pair?.baseToken?.symbol || null,
          priceUsd,
          valueUsd,
          marketCap: Number(pair?.marketCap || 0),
          liquidityUsd: Number(pair?.liquidity?.usd || 0),
          change24h: Number(pair?.priceChange?.h24 || 0),
          volume24h: Number(pair?.volume?.h24 || 0),
          pairUrl: pair?.url || null,
          intelligence,
        }
      })
      .sort((a, b) => b.valueUsd - a.valueUsd)

    return NextResponse.json({
      success: true,
      scannedAt: new Date().toISOString(),
      wallet: address,
      solBalance: snapshot.solBalance,
      tokenCount: holdings.length,
      portfolioTokenValueUsd,
      holdings,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Wallet load failed.' },
      { status: 500 },
    )
  }
}
