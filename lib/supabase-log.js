const SUPABASE_URL = 'https://vmiaajhjcdqtojpyicux.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_55I4aMBK66DBjB3imBmoxg_gWKRz3Zv'

export async function logTokenScan(scan, aiSummary = null) {
  if (!scan?.address) return false

  const body = {
    token_address: scan.address,
    token_name: scan?.token?.name,
    token_symbol: scan?.token?.symbol,
    score: scan?.intelligence?.score,
    risk: scan?.intelligence?.risk,
    signal: scan?.intelligence?.signal,
    confidence: scan?.intelligence?.confidence,
    price_usd: scan?.market?.priceUsd,
    market_cap: scan?.market?.marketCap,
    liquidity_usd: scan?.market?.liquidityUsd,
    volume_24h: scan?.market?.volume?.h24,
    ai_summary: aiSummary,
    payload: {
      pair: scan?.pair,
      intelligence: {
        grade: scan?.intelligence?.grade,
        riskFlags: scan?.intelligence?.riskFlags,
        breakdown: scan?.intelligence?.breakdown,
      },
    },
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/rcxt-log`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    return response.ok
  } catch {
    return false
  }
}
