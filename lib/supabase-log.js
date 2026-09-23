const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://vmiaajhjcdqtojpyicux.supabase.co'

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_55I4aMBK66DBjB3imBmoxg_gWKRz3Zv'

async function postLog(body, oidcToken = null) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/rcxt-log`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        ...(oidcToken ? { 'x-rcxt-vercel-oidc': oidcToken } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(3500),
    })

    let result = null
    try { result = await response.json() } catch {}

    return {
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : (result?.error || `Supabase function HTTP ${response.status}`),
    }
  } catch (error) {
    return { ok:false, status:0, error:error?.message || 'Supabase function request failed' }
  }
}

export async function logTokenScan(scan, aiSummary = null, oidcToken = null) {
  if (!scan?.address) return { ok:false, status:0, error:'Missing scan address' }

  return postLog({
    kind: 'token_scan',
    token_address: scan.address,
    token_name: scan?.token?.name,
    token_symbol: scan?.token?.symbol,
    score: scan?.intelligence?.score,
    score_version: scan?.intelligence?.modelVersion,
    risk: scan?.intelligence?.risk,
    signal: scan?.intelligence?.signal,
    confidence: scan?.intelligence?.confidence,
    setup_score: scan?.intelligence?.setupScore,
    execution_score: scan?.intelligence?.executionScore,
    safety_score: scan?.intelligence?.safetyScore,
    data_quality_score: scan?.intelligence?.dataQualityScore,
    market_state: scan?.intelligence?.marketState,
    risk_flag_count: Array.isArray(scan?.intelligence?.riskFlags) ? scan.intelligence.riskFlags.length : 0,
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
        opportunityScore: scan?.intelligence?.opportunityScore,
        opportunityLabel: scan?.intelligence?.opportunityLabel,
        directionalBias: scan?.intelligence?.directionalBias,
        hotMomentum: Boolean(scan?.intelligence?.hotMomentum),
        preliminary: scan?.intelligence?.preliminary,
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
        sources: scan?.security?.sources || null,
      },
    },
  }, oidcToken)
}

export async function logWalletSnapshot(snapshot, oidcToken = null) {
  if (!snapshot?.wallet) return { ok:false, status:0, error:'Missing wallet address' }

  const holdings = Array.isArray(snapshot.holdings)
    ? snapshot.holdings.slice(0, 150).map((item) => ({
        mint: item.mint,
        symbol: item.symbol,
        balance: item.balance,
        priceUsd: item.priceUsd,
        valueUsd: item.valueUsd,
        liquidityUsd: item.liquidityUsd,
        score: item.intelligence?.score,
        signal: item.intelligence?.signal,
        risk: item.intelligence?.risk,
        modelVersion: item.intelligence?.modelVersion,
      }))
    : []

  return postLog({
    kind: 'wallet_snapshot',
    wallet_address: snapshot.wallet,
    sol_balance: snapshot.solBalance,
    token_count: snapshot.tokenCount,
    token_value_usd: snapshot.portfolioTokenValueUsd,
    sol_price_usd: snapshot.solPriceUsd,
    sol_value_usd: snapshot.solValueUsd,
    total_value_usd: snapshot.portfolioTotalUsd,
    payload: {
      holdings,
      pricedTokenCount: holdings.filter((item) => Number(item.priceUsd || 0) > 0).length,
    },
  }, oidcToken)
}


export async function checkPersistenceHealth() {
  const started = Date.now()
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/rcxt-log`, {
      method: 'GET',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    })

    let body = null
    try { body = await response.json() } catch {}

    return {
      ok: response.ok && body?.ok === true,
      latencyMs: Date.now() - started,
      version: body?.version ?? null,
    }
  } catch {
    return { ok:false, latencyMs:Date.now()-started, version:null }
  }
}


export async function logSocialSnapshot({ address, symbol, social }, oidcToken = null) {
  if (!address || !social?.available) return { ok:false, status:0, error:'Missing social snapshot data' }

  return postLog({
    kind: 'social_scan',
    token_address: address,
    token_symbol: symbol || null,
    momentum_score: social.momentumScore,
    quality_score: social.qualityScore,
    source_diversity: social.sourceDiversity,
    mention_count: social.mentionCount,
    unique_authors: social.uniqueAuthors,
    engagement: social.engagement,
    sentiment: social.sentiment,
    relevance_score: social.relevanceScore,
    duplicate_ratio: social.duplicateRatio,
    author_concentration: social.authorConcentration,
    payload: {
      providers: (social.providers || []).map((provider) => ({
        source: provider.source,
        available: provider.available,
        mentionCount: provider.mentionCount ?? 0,
        uniqueAuthors: provider.uniqueAuthors ?? 0,
        engagement: provider.engagement ?? 0,
        sentiment: provider.sentiment ?? 0,
        duplicateRatio: provider.duplicateRatio ?? 0,
        authorConcentration: provider.authorConcentration ?? 0,
        relevanceScore: provider.relevanceScore ?? 0,
        latestAt: provider.latestAt ?? null,
        reason: provider.available ? null : provider.reason || null,
      })),
    },
  }, oidcToken)
}

export async function logAiAnalysis({ scan, model, analysis, social }, oidcToken = null) {
  if (!scan?.address || !analysis) return { ok:false, status:0, error:'Missing AI analysis data' }

  return postLog({
    kind: 'ai_analysis',
    token_address: scan.address,
    token_symbol: scan?.token?.symbol || null,
    score_version: scan?.intelligence?.modelVersion || null,
    model: model || 'unknown',
    analysis,
    payload: {
      score: scan?.intelligence?.score,
      signal: scan?.intelligence?.signal,
      risk: scan?.intelligence?.risk,
      setupScore: scan?.intelligence?.setupScore,
      executionScore: scan?.intelligence?.executionScore,
      safetyScore: scan?.intelligence?.safetyScore,
      dataQualityScore: scan?.intelligence?.dataQualityScore,
      social: social?.available
        ? {
            momentumScore: social.momentumScore,
            qualityScore: social.qualityScore,
            sourceDiversity: social.sourceDiversity,
            mentionCount: social.mentionCount,
          }
        : null,
    },
  }, oidcToken)
}
