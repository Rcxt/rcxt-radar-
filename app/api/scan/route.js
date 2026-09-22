import { NextResponse } from 'next/server'
import { getBestPair } from '@/lib/dexscreener'
import { analyzePair } from '@/lib/intelligence'
import { getMintSecurity, looksLikeSolanaAddress } from '@/lib/solana'
import { logTokenScan } from '@/lib/supabase-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const address = request.nextUrl.searchParams.get('address')?.trim()

  if (!looksLikeSolanaAddress(address)) {
    return NextResponse.json(
      { success: false, error: 'Enter a valid Solana token address.' },
      { status: 400 },
    )
  }

  try {
    const [pair, mintSecurity] = await Promise.all([
      getBestPair(address),
      getMintSecurity(address),
    ])

    if (!pair) {
      return NextResponse.json(
        { success: false, error: 'No active DexScreener market found for this token.' },
        { status: 404 },
      )
    }

    const intelligence = analyzePair(pair, mintSecurity)
    const buys = {
      m5: Number(pair?.txns?.m5?.buys || 0),
      h1: Number(pair?.txns?.h1?.buys || 0),
      h6: Number(pair?.txns?.h6?.buys || 0),
      h24: Number(pair?.txns?.h24?.buys || 0),
    }
    const sells = {
      m5: Number(pair?.txns?.m5?.sells || 0),
      h1: Number(pair?.txns?.h1?.sells || 0),
      h6: Number(pair?.txns?.h6?.sells || 0),
      h24: Number(pair?.txns?.h24?.sells || 0),
    }

    const scan = {
      address,
      token: {
        name: pair?.baseToken?.name || 'Unknown',
        symbol: pair?.baseToken?.symbol || 'UNKNOWN',
        address,
      },
      market: {
        priceUsd: Number(pair?.priceUsd || 0),
        priceNative: Number(pair?.priceNative || 0),
        marketCap: Number(pair?.marketCap || 0),
        fdv: Number(pair?.fdv || 0),
        liquidityUsd: Number(pair?.liquidity?.usd || 0),
        volume: {
          m5: Number(pair?.volume?.m5 || 0),
          h1: Number(pair?.volume?.h1 || 0),
          h6: Number(pair?.volume?.h6 || 0),
          h24: Number(pair?.volume?.h24 || 0),
        },
        priceChange: {
          m5: Number(pair?.priceChange?.m5 || 0),
          h1: Number(pair?.priceChange?.h1 || 0),
          h6: Number(pair?.priceChange?.h6 || 0),
          h24: Number(pair?.priceChange?.h24 || 0),
        },
      },
      trading: {
        buys,
        sells,
        transactions: {
          m5: buys.m5 + sells.m5,
          h1: buys.h1 + sells.h1,
          h6: buys.h6 + sells.h6,
          h24: buys.h24 + sells.h24,
        },
      },
      security: mintSecurity,
      pair: {
        dex: pair?.dexId || null,
        pairAddress: pair?.pairAddress || null,
        url: pair?.url || null,
        createdAt: pair?.pairCreatedAt || null,
      },
      intelligence,
    }

    await Promise.race([
      logTokenScan(scan),
      new Promise((resolve) => setTimeout(resolve, 800)),
    ])

    return NextResponse.json({
      success: true,
      scannedAt: new Date().toISOString(),
      scan,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Token scan failed.' },
      { status: 500 },
    )
  }
}
