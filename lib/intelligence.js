function n(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function analyzePair(pair, mintSecurity = null) {
  if (!pair) {
    return {
      score: 0,
      signal: 'NO MARKET',
      confidence: 0,
      risk: 'EXTREME',
      riskFlags: ['No active DexScreener market found'],
      positives: [],
      negatives: ['No liquid market is available to evaluate'],
      breakdown: {},
    }
  }

  const liquidity = n(pair?.liquidity?.usd)
  const marketCap = n(pair?.marketCap) || n(pair?.fdv)
  const volume24 = n(pair?.volume?.h24)
  const volume6 = n(pair?.volume?.h6)
  const volume1 = n(pair?.volume?.h1)
  const volume5 = n(pair?.volume?.m5)

  const change24 = n(pair?.priceChange?.h24)
  const change6 = n(pair?.priceChange?.h6)
  const change1 = n(pair?.priceChange?.h1)
  const change5 = n(pair?.priceChange?.m5)

  const buys24 = n(pair?.txns?.h24?.buys)
  const sells24 = n(pair?.txns?.h24?.sells)
  const buys1 = n(pair?.txns?.h1?.buys)
  const sells1 = n(pair?.txns?.h1?.sells)

  const tx24 = buys24 + sells24
  const tx1 = buys1 + sells1
  const buyPct24 = tx24 > 0 ? (buys24 / tx24) * 100 : 50
  const buyPct1 = tx1 > 0 ? (buys1 / tx1) * 100 : 50

  const ageHours = pair?.pairCreatedAt
    ? Math.max(0, (Date.now() - Number(pair.pairCreatedAt)) / 3_600_000)
    : null

  const liquidityRatio = marketCap > 0 ? liquidity / marketCap : 0
  const turnover = liquidity > 0 ? volume24 / liquidity : 0
  const volumeAcceleration =
    volume1 > 0 && volume6 > 0 ? (volume1 * 6) / volume6 : 1
  const microAcceleration =
    volume5 > 0 && volume1 > 0 ? (volume5 * 12) / volume1 : 1

  const symbol = String(pair?.baseToken?.symbol || '').toUpperCase()
  const name = String(pair?.baseToken?.name || '').toUpperCase()
  const stableSymbols = new Set(['USDC', 'USDT', 'PYUSD', 'USDS', 'USD1', 'USDE', 'FDUSD'])
  const stableAsset = stableSymbols.has(symbol) || name === 'USD COIN' || name === 'TETHER USD'

  if (stableAsset) {
    return {
      score: 50,
      grade: 'N/A',
      signal: 'WATCH',
      confidence: 96,
      risk: 'LOWER',
      buyPercent24h: Number(buyPct24.toFixed(1)),
      buyPercent1h: Number(buyPct1.toFixed(1)),
      liquidityToCapPercent: Number((liquidityRatio * 100).toFixed(2)),
      turnover24h: Number(turnover.toFixed(2)),
      volumeAcceleration: Number(volumeAcceleration.toFixed(2)),
      ageHours: ageHours === null ? null : Number(ageHours.toFixed(1)),
      riskFlags: ['STABLE_ASSET'],
      positives: ['Stable-value asset; directional trade signal suppressed'],
      negatives: [],
      breakdown: { liquidity: 0, activity: 0, orderFlow: 0, momentum: 0, maturity: 0, contract: 0 },
    }
  }

  let score = 50
  const positives = []
  const negatives = []
  const riskFlags = []
  const breakdown = {
    liquidity: 0,
    activity: 0,
    orderFlow: 0,
    momentum: 0,
    maturity: 0,
    contract: 0,
  }

  if (liquidity >= 150000) {
    breakdown.liquidity += 18
    positives.push('Deep liquidity for a meme-coin market')
  } else if (liquidity >= 50000) {
    breakdown.liquidity += 12
    positives.push('Healthy liquidity depth')
  } else if (liquidity >= 15000) {
    breakdown.liquidity += 5
  } else if (liquidity >= 5000) {
    breakdown.liquidity -= 4
    negatives.push('Liquidity is thin')
  } else {
    breakdown.liquidity -= 18
    negatives.push('Very low liquidity')
    riskFlags.push('LOW_LIQUIDITY')
  }

  if (liquidityRatio >= 0.18) {
    breakdown.liquidity += 8
    positives.push('Strong liquidity relative to market cap')
  } else if (marketCap > 0 && liquidityRatio < 0.03) {
    breakdown.liquidity -= 8
    negatives.push('Weak liquidity-to-market-cap ratio')
    riskFlags.push('LOW_LIQUIDITY_RATIO')
  }

  if (volume24 >= 100000 && turnover >= 1.2) {
    breakdown.activity += 12
    positives.push('High 24h turnover')
  } else if (volume24 >= 25000) {
    breakdown.activity += 6
  } else if (volume24 < 2500) {
    breakdown.activity -= 8
    negatives.push('Low trading activity')
  }

  if (volumeAcceleration >= 1.35) {
    breakdown.activity += 7
    positives.push('Hourly volume is accelerating')
  } else if (volumeAcceleration < 0.55) {
    breakdown.activity -= 5
    negatives.push('Volume is fading')
  }

  if (microAcceleration >= 1.6 && volume5 > 300) {
    breakdown.activity += 3
    positives.push('5m activity is expanding')
  }

  if (tx24 >= 120 && buyPct24 >= 54 && buyPct24 <= 72) {
    breakdown.orderFlow += 8
    positives.push('Constructive 24h buy pressure')
  } else if (tx24 > 0 && buyPct24 < 38) {
    breakdown.orderFlow -= 9
    negatives.push('Sellers dominate 24h flow')
  } else if (tx24 > 0 && buyPct24 > 86) {
    breakdown.orderFlow -= 3
    negatives.push('Order flow is unusually one-sided')
    riskFlags.push('EXTREME_BUY_IMBALANCE')
  }

  if (tx1 >= 20 && buyPct1 >= 56 && buyPct1 <= 78) {
    breakdown.orderFlow += 4
  } else if (tx1 >= 10 && buyPct1 < 35) {
    breakdown.orderFlow -= 5
    negatives.push('Recent order flow has weakened')
  }

  if (change24 >= 8 && change24 <= 110) {
    breakdown.momentum += 7
    positives.push('Positive 24h momentum')
  }
  if (change6 >= 2 && change6 <= 55) breakdown.momentum += 4
  if (change1 >= 0 && change1 <= 25) breakdown.momentum += 2

  if (change24 < -35) {
    breakdown.momentum -= 11
    negatives.push('Heavy 24h drawdown')
  }
  if (change6 < -22) {
    breakdown.momentum -= 6
    negatives.push('6h momentum is bearish')
  }
  if (change1 < -14) breakdown.momentum -= 4

  if (change24 > 250 || change6 > 130 || change1 > 70 || change5 > 35) {
    breakdown.momentum -= 9
    negatives.push('Price is extended; chase risk is elevated')
    riskFlags.push('PARABOLIC_MOVE')
  }

  if (ageHours !== null) {
    if (ageHours < 0.5) {
      breakdown.maturity -= 10
      riskFlags.push('VERY_NEW_PAIR')
      negatives.push('Pair is less than 30 minutes old')
    } else if (ageHours < 3) {
      breakdown.maturity -= 5
      riskFlags.push('NEW_PAIR')
    } else if (ageHours >= 24) {
      breakdown.maturity += 5
      positives.push('Pair has survived beyond 24 hours')
    }
    if (ageHours >= 168) breakdown.maturity += 2
  }

  if (mintSecurity?.available) {
    if (mintSecurity.mintAuthority) {
      breakdown.contract -= 10
      negatives.push('Mint authority is still active')
      riskFlags.push('MINT_AUTHORITY_ACTIVE')
    } else {
      breakdown.contract += 4
      positives.push('Mint authority is disabled')
    }

    if (mintSecurity.freezeAuthority) {
      breakdown.contract -= 9
      negatives.push('Freeze authority is still active')
      riskFlags.push('FREEZE_AUTHORITY_ACTIVE')
    } else {
      breakdown.contract += 4
      positives.push('Freeze authority is disabled')
    }
  }

  score += Object.values(breakdown).reduce((sum, value) => sum + value, 0)
  score = clamp(Math.round(score), 0, 100)

  const dataDepth =
    Math.min(20, tx24 / 25) +
    Math.min(20, volume24 / 15000) +
    Math.min(20, liquidity / 25000) +
    (mintSecurity?.available ? 12 : 0)

  const confidence = clamp(Math.round(35 + dataDepth), 35, 96)

  const contractDanger =
    riskFlags.includes('MINT_AUTHORITY_ACTIVE') ||
    riskFlags.includes('FREEZE_AUTHORITY_ACTIVE')
  const liquidityDanger = riskFlags.includes('LOW_LIQUIDITY')
  const chaseDanger = riskFlags.includes('PARABOLIC_MOVE')
  const collapseDanger = change24 < -45 || change6 < -35
  const sellerDanger = buyPct24 < 34 && tx24 >= 40

  let signal = 'WATCH'

  if (contractDanger || liquidityDanger || score < 40) {
    signal = 'SELL / AVOID'
  } else if (collapseDanger || sellerDanger || score < 52) {
    signal = 'REDUCE'
  } else if (chaseDanger) {
    signal = 'WATCH'
  } else if (
    score >= 82 &&
    change24 >= -10 &&
    change24 <= 120 &&
    change6 >= -12 &&
    liquidity >= 15000 &&
    (ageHours === null || ageHours >= 1)
  ) {
    signal = 'BUY SETUP'
  } else if (
    score >= 70 &&
    change24 >= -20 &&
    change24 <= 150 &&
    change6 >= -18 &&
    liquidity >= 8000
  ) {
    signal = 'LEAN BUY'
  } else {
    signal = 'WATCH'
  }

  let risk = 'MODERATE'
  if (score >= 78 && riskFlags.length === 0) risk = 'LOWER'
  if (
    score < 58 ||
    riskFlags.length >= 2 ||
    chaseDanger ||
    collapseDanger ||
    sellerDanger
  ) risk = 'HIGH'
  if (
    score < 40 ||
    riskFlags.length >= 4 ||
    contractDanger ||
    liquidityDanger
  ) risk = 'EXTREME'

  return {
    score,
    grade:
      score >= 85 ? 'A' :
      score >= 75 ? 'B' :
      score >= 62 ? 'C' :
      score >= 48 ? 'D' : 'F',
    signal,
    confidence,
    risk,
    buyPercent24h: Number(buyPct24.toFixed(1)),
    buyPercent1h: Number(buyPct1.toFixed(1)),
    liquidityToCapPercent: Number((liquidityRatio * 100).toFixed(2)),
    turnover24h: Number(turnover.toFixed(2)),
    volumeAcceleration: Number(volumeAcceleration.toFixed(2)),
    ageHours: ageHours === null ? null : Number(ageHours.toFixed(1)),
    riskFlags,
    positives: positives.slice(0, 6),
    negatives: negatives.slice(0, 6),
    breakdown,
  }
}
