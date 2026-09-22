function n(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function finite(value) {
  return Number.isFinite(Number(value))
}

export const SCORE_VERSION = '3.0.0'

export function analyzePair(pair, mintSecurity = null) {
  if (!pair) {
    return {
      modelVersion: SCORE_VERSION,
      score: 0,
      grade: 'F',
      signal: 'NO MARKET',
      confidence: 0,
      risk: 'EXTREME',
      marketState: 'NO MARKET',
      riskFlags: ['NO_MARKET'],
      positives: [],
      negatives: ['No active DexScreener market is available to evaluate'],
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
  const buys5 = n(pair?.txns?.m5?.buys)
  const sells5 = n(pair?.txns?.m5?.sells)

  const tx24 = buys24 + sells24
  const tx1 = buys1 + sells1
  const tx5 = buys5 + sells5
  const buyPct24 = tx24 > 0 ? (buys24 / tx24) * 100 : 50
  const buyPct1 = tx1 > 0 ? (buys1 / tx1) * 100 : 50
  const buyPct5 = tx5 > 0 ? (buys5 / tx5) * 100 : 50

  const ageHours = pair?.pairCreatedAt
    ? Math.max(0, (Date.now() - Number(pair.pairCreatedAt)) / 3_600_000)
    : null

  const liquidityRatio = marketCap > 0 ? liquidity / marketCap : 0
  const turnover = liquidity > 0 ? volume24 / liquidity : 0
  const volumeAcceleration = volume1 > 0 && volume6 > 0 ? (volume1 * 6) / volume6 : 1
  const microAcceleration = volume5 > 0 && volume1 > 0 ? (volume5 * 12) / volume1 : 1

  const symbol = String(pair?.baseToken?.symbol || '').toUpperCase()
  const name = String(pair?.baseToken?.name || '').toUpperCase()
  const stableSymbols = new Set(['USDC','USDT','PYUSD','USDS','USD1','USDE','FDUSD'])
  const stableAsset = stableSymbols.has(symbol) || name === 'USD COIN' || name === 'TETHER USD'

  if (stableAsset) {
    return {
      modelVersion: SCORE_VERSION,
      score: 50,
      grade: 'N/A',
      signal: 'WATCH',
      confidence: 96,
      risk: 'LOWER',
      marketState: 'STABLE ASSET',
      buyPercent24h: Number(buyPct24.toFixed(1)),
      buyPercent1h: Number(buyPct1.toFixed(1)),
      buyPercent5m: Number(buyPct5.toFixed(1)),
      liquidityToCapPercent: Number((liquidityRatio * 100).toFixed(2)),
      turnover24h: Number(turnover.toFixed(2)),
      volumeAcceleration: Number(volumeAcceleration.toFixed(2)),
      ageHours: ageHours === null ? null : Number(ageHours.toFixed(1)),
      riskFlags: ['STABLE_ASSET'],
      positives: ['Stable-value asset; directional trade signal suppressed'],
      negatives: [],
      breakdown: { liquidity:0, activity:0, orderFlow:0, momentum:0, maturity:0, contract:0, concentration:0 },
    }
  }

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
    concentration: 0,
  }

  // Liquidity: reward usable depth, but do not let deep liquidity hide bad momentum.
  if (liquidity >= 250000) {
    breakdown.liquidity += 16
    positives.push('Deep liquidity')
  } else if (liquidity >= 100000) {
    breakdown.liquidity += 13
    positives.push('Strong liquidity depth')
  } else if (liquidity >= 30000) {
    breakdown.liquidity += 9
    positives.push('Healthy liquidity depth')
  } else if (liquidity >= 10000) {
    breakdown.liquidity += 3
  } else if (liquidity >= 4000) {
    breakdown.liquidity -= 6
    negatives.push('Liquidity is thin')
  } else {
    breakdown.liquidity -= 20
    negatives.push('Very low liquidity')
    riskFlags.push('LOW_LIQUIDITY')
  }

  if (marketCap > 0) {
    if (liquidityRatio >= 0.20) {
      breakdown.liquidity += 5
      positives.push('Strong liquidity relative to market cap')
    } else if (liquidityRatio < 0.025) {
      breakdown.liquidity -= 8
      negatives.push('Weak liquidity-to-market-cap ratio')
      riskFlags.push('LOW_LIQUIDITY_RATIO')
    }
  }

  // Activity: volume matters most when it is sustainable relative to liquidity.
  if (volume24 >= 250000 && turnover >= 1.5) {
    breakdown.activity += 11
    positives.push('Strong 24h turnover')
  } else if (volume24 >= 50000 && turnover >= 0.6) {
    breakdown.activity += 6
  } else if (volume24 < 3000) {
    breakdown.activity -= 9
    negatives.push('Low trading activity')
  }

  if (volumeAcceleration >= 1.45) {
    breakdown.activity += 5
    positives.push('Hourly volume is accelerating')
  } else if (volumeAcceleration < 0.45) {
    breakdown.activity -= 6
    negatives.push('Hourly volume is fading')
  }

  if (microAcceleration >= 1.8 && volume5 >= 500) {
    breakdown.activity += 2
    positives.push('5m activity is expanding')
  } else if (microAcceleration < 0.35 && volume1 >= 1000) {
    breakdown.activity -= 2
  }

  // Order flow: reward balanced buyer leadership, punish seller domination and manic imbalance.
  if (tx24 >= 100) {
    if (buyPct24 >= 54 && buyPct24 <= 72) {
      breakdown.orderFlow += 6
      positives.push('Constructive 24h buy pressure')
    } else if (buyPct24 < 38) {
      breakdown.orderFlow -= 10
      negatives.push('Sellers dominate 24h flow')
      riskFlags.push('SELLER_DOMINANCE')
    } else if (buyPct24 > 86) {
      breakdown.orderFlow -= 3
      negatives.push('24h order flow is unusually one-sided')
      riskFlags.push('EXTREME_BUY_IMBALANCE')
    }
  }

  if (tx1 >= 20) {
    if (buyPct1 >= 54 && buyPct1 <= 76) {
      breakdown.orderFlow += 5
      positives.push('1h buyers are leading')
    } else if (buyPct1 < 38) {
      breakdown.orderFlow -= 7
      negatives.push('1h sellers are leading')
      riskFlags.push('RECENT_SELL_PRESSURE')
    } else if (buyPct1 > 84) {
      breakdown.orderFlow -= 2
    }
  }

  if (tx5 >= 8 && buyPct5 < 32) {
    breakdown.orderFlow -= 3
    negatives.push('5m flow is seller-heavy')
  }

  // Momentum: multi-timeframe agreement is required for high scores.
  if (change24 >= 5 && change24 <= 90) {
    breakdown.momentum += 5
    positives.push('24h momentum is constructive')
  } else if (change24 < -25) {
    breakdown.momentum -= 9
    negatives.push('24h trend is weak')
  }

  if (change6 >= 2 && change6 <= 45) {
    breakdown.momentum += 5
    positives.push('6h momentum is constructive')
  } else if (change6 < -18) {
    breakdown.momentum -= 9
    negatives.push('6h momentum is bearish')
    riskFlags.push('BEARISH_6H')
  }

  if (change1 >= 0.5 && change1 <= 20) {
    breakdown.momentum += 4
    positives.push('1h momentum is positive')
  } else if (change1 < -10) {
    breakdown.momentum -= 6
    negatives.push('1h momentum is deteriorating')
    riskFlags.push('BEARISH_1H')
  }

  if (change5 < -12) {
    breakdown.momentum -= 3
    negatives.push('5m momentum is sharply negative')
  }

  const parabolic =
    change24 > 220 ||
    change6 > 110 ||
    change1 > 55 ||
    change5 > 28

  if (parabolic) {
    breakdown.momentum -= 12
    negatives.push('Price is extended; chase risk is elevated')
    riskFlags.push('PARABOLIC_MOVE')
  }

  // Maturity: newborn pairs should not receive top-tier conviction.
  if (ageHours !== null) {
    if (ageHours < 0.25) {
      breakdown.maturity -= 10
      negatives.push('Pair is less than 15 minutes old')
      riskFlags.push('VERY_NEW_PAIR')
    } else if (ageHours < 1) {
      breakdown.maturity -= 6
      riskFlags.push('NEW_PAIR')
    } else if (ageHours < 3) {
      breakdown.maturity -= 2
    } else if (ageHours >= 24) {
      breakdown.maturity += 4
      positives.push('Pair has survived beyond 24 hours')
    }
    if (ageHours >= 168) breakdown.maturity += 1
  }

  // Contract permissions.
  if (mintSecurity?.available) {
    if (mintSecurity.mintAuthority) {
      breakdown.contract -= 12
      negatives.push('Mint authority is still active')
      riskFlags.push('MINT_AUTHORITY_ACTIVE')
    } else {
      breakdown.contract += 4
      positives.push('Mint authority is disabled')
    }

    if (mintSecurity.freezeAuthority) {
      breakdown.contract -= 11
      negatives.push('Freeze authority is still active')
      riskFlags.push('FREEZE_AUTHORITY_ACTIVE')
    } else {
      breakdown.contract += 4
      positives.push('Freeze authority is disabled')
    }
  }

  // Token-account concentration. This is not perfect holder analysis because LP/burn accounts can be present,
  // so it influences risk conservatively rather than acting as a hard rug verdict.
  const top1 = finite(mintSecurity?.top1Percent) ? Number(mintSecurity.top1Percent) : null
  const top5 = finite(mintSecurity?.top5Percent) ? Number(mintSecurity.top5Percent) : null
  const top10 = finite(mintSecurity?.top10Percent) ? Number(mintSecurity.top10Percent) : null

  if (mintSecurity?.concentrationAvailable) {
    if (top1 !== null && top1 >= 70) {
      breakdown.concentration -= 12
      negatives.push('Largest token account controls an extreme share of supply')
      riskFlags.push('EXTREME_ACCOUNT_CONCENTRATION')
    } else if (top1 !== null && top1 >= 45) {
      breakdown.concentration -= 6
      negatives.push('Largest token account concentration is elevated')
      riskFlags.push('HIGH_ACCOUNT_CONCENTRATION')
    } else if (top1 !== null && top1 <= 20) {
      breakdown.concentration += 2
    }

    if (top10 !== null && top10 >= 92) {
      breakdown.concentration -= 5
      negatives.push('Top token accounts hold most of the supply')
    } else if (top10 !== null && top10 <= 65) {
      breakdown.concentration += 2
      positives.push('Token-account concentration is comparatively distributed')
    }
  }

  let score = 50 + Object.values(breakdown).reduce((sum, value) => sum + value, 0)

  const contractDanger =
    riskFlags.includes('MINT_AUTHORITY_ACTIVE') ||
    riskFlags.includes('FREEZE_AUTHORITY_ACTIVE')
  const liquidityDanger = liquidity < 4000
  const concentrationDanger = riskFlags.includes('EXTREME_ACCOUNT_CONCENTRATION')
  const chaseDanger = riskFlags.includes('PARABOLIC_MOVE')
  const collapseDanger = change24 < -45 || change6 < -35
  const sellerDanger =
    (buyPct24 < 34 && tx24 >= 40) ||
    (buyPct1 < 32 && tx1 >= 15)
  const shortTermWeakness = change1 < -10 || change6 < -18
  const newborn = ageHours !== null && ageHours < 0.25

  // Risk caps keep headline score consistent with the signal.
  if (contractDanger) score = Math.min(score, 34)
  if (liquidityDanger) score = Math.min(score, 32)
  if (concentrationDanger) score = Math.min(score, 42)
  if (collapseDanger) score = Math.min(score, 46)
  if (sellerDanger) score = Math.min(score, 50)
  if (chaseDanger) score = Math.min(score, 68)
  if (shortTermWeakness) score = Math.min(score, 66)
  if (change24 < -25) score = Math.min(score, 72)
  if (newborn) score = Math.min(score, 58)

  score = clamp(Math.round(score), 0, 100)

  const dataDepth =
    Math.min(18, tx24 / 30) +
    Math.min(16, tx1 / 8) +
    Math.min(18, volume24 / 20000) +
    Math.min(18, liquidity / 30000) +
    (mintSecurity?.available ? 10 : 0) +
    (mintSecurity?.concentrationAvailable ? 8 : 0)

  const confidence = clamp(Math.round(28 + dataDepth), 30, 96)

  let signal = 'WATCH'

  if (contractDanger || liquidityDanger || concentrationDanger || score < 38) {
    signal = 'SELL / AVOID'
  } else if (collapseDanger || sellerDanger || score < 50) {
    signal = 'REDUCE'
  } else if (chaseDanger || shortTermWeakness || score < 68) {
    signal = 'WATCH'
  } else {
    const commonEntryQuality =
      liquidity >= 10_000 &&
      change1 >= -5 &&
      change6 >= -8 &&
      change24 >= -15 &&
      change24 <= 150 &&
      buyPct1 >= 48 &&
      buyPct1 <= 80 &&
      !riskFlags.includes('VERY_NEW_PAIR')

    if (
      score >= 82 &&
      confidence >= 62 &&
      commonEntryQuality &&
      liquidity >= 20_000 &&
      change1 <= 24 &&
      change6 <= 65 &&
      change24 <= 120 &&
      buyPct1 >= 52 &&
      buyPct1 <= 76 &&
      volumeAcceleration >= 0.65 &&
      (ageHours === null || ageHours >= 1)
    ) {
      signal = 'BUY SETUP'
    } else if (score >= 72 && commonEntryQuality) {
      signal = 'LEAN BUY'
    }
  }

  // Keep the headline number aligned with the action label.
  if (signal === 'SELL / AVOID') score = Math.min(score, 37)
  else if (signal === 'REDUCE') score = Math.min(score, 49)
  else if (signal === 'WATCH') score = Math.min(score, 74)
  else if (signal === 'LEAN BUY') score = clamp(score, 68, 84)

  let risk = 'MODERATE'
  if (score >= 80 && riskFlags.length === 0) risk = 'LOWER'
  if (
    score < 60 ||
    riskFlags.length >= 2 ||
    chaseDanger ||
    shortTermWeakness ||
    sellerDanger
  ) risk = 'HIGH'
  if (
    score < 40 ||
    riskFlags.length >= 4 ||
    contractDanger ||
    liquidityDanger ||
    concentrationDanger
  ) risk = 'EXTREME'

  let marketState = 'BALANCED'
  if (chaseDanger) marketState = 'EXTENDED'
  else if (collapseDanger || sellerDanger) marketState = 'DETERIORATING'
  else if (signal === 'BUY SETUP') marketState = 'STRONG SETUP'
  else if (signal === 'LEAN BUY') marketState = 'CONSTRUCTIVE'
  else if (shortTermWeakness) marketState = 'WEAKENING'

  return {
    modelVersion: SCORE_VERSION,
    score,
    grade:
      score >= 86 ? 'A' :
      score >= 76 ? 'B' :
      score >= 64 ? 'C' :
      score >= 50 ? 'D' : 'F',
    signal,
    confidence,
    risk,
    marketState,
    buyPercent24h: Number(buyPct24.toFixed(1)),
    buyPercent1h: Number(buyPct1.toFixed(1)),
    buyPercent5m: Number(buyPct5.toFixed(1)),
    liquidityToCapPercent: Number((liquidityRatio * 100).toFixed(2)),
    turnover24h: Number(turnover.toFixed(2)),
    volumeAcceleration: Number(volumeAcceleration.toFixed(2)),
    microAcceleration: Number(microAcceleration.toFixed(2)),
    ageHours: ageHours === null ? null : Number(ageHours.toFixed(1)),
    concentration: {
      available: Boolean(mintSecurity?.concentrationAvailable),
      top1Percent: top1,
      top5Percent: top5,
      top10Percent: top10,
    },
    riskFlags: [...new Set(riskFlags)],
    positives: [...new Set(positives)].slice(0, 7),
    negatives: [...new Set(negatives)].slice(0, 7),
    breakdown,
  }
}
