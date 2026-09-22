const SUPABASE_URL = 'https://vmiaajhjcdqtojpyicux.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_55I4aMBK66DBjB3imBmoxg_gWKRz3Zv'

export async function logTokenScan(scan, aiSummary = null) {
  if (!scan?.address) return { ok:false, status:0, error:'Missing scan address' }

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
        modelVersion: scan?.intelligence?.modelVersion,
        grade: scan?.intelligence?.grade,
        marketState: scan?.intelligence?.marketState,
        riskFlags: scan?.intelligence?.riskFlags,
        concentration: scan?.intelligence?.concentration,
        breakdown: scan?.intelligence?.breakdown,
      },
      security: {
        mintAuthority: scan?.security?.mintAuthority || null,
        freezeAuthority: scan?.security?.freezeAuthority || null,
        top1Percent: scan?.security?.top1Percent ?? null,
        top5Percent: scan?.security?.top5Percent ?? null,
        top10Percent: scan?.security?.top10Percent ?? null,
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
      signal: AbortSignal.timeout(3500),
    })

    let result = null
    try {
      result = await response.json()
    } catch {
      result = null
    }

    return {
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : (result?.error || `Supabase function HTTP ${response.status}`),
    }
  } catch (error) {
    return { ok:false, status:0, error:error?.message || 'Supabase function request failed' }
  }
}
