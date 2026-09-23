function n(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function finite(value) {
  if (value === null || value === undefined || value === '') return false
  return Number.isFinite(Number(value))
}

function round(value, digits = 1) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export const SCORE_VERSION = '4.2.1'

export function analyzePair(pair, mintSecurity = null) {
  if (!pair) {
    return {
      modelVersion: SCORE_VERSION, score: 0, setupScore: 0, executionScore: 0,
      safetyScore: 0, dataQualityScore: 0, grade: 'F', signal: 'NO MARKET',
      confidence: 0, risk: 'EXTREME', marketState: 'NO MARKET', preliminary: true,
      contractVerified: false, riskFlags: ['NO_MARKET'], positives: [],
      negatives: ['No active DexScreener market is available to evaluate'], breakdown: {},
    }
  }

  const dexId = String(pair?.dexId || '').toLowerCase()
  const rawLiquidity = pair?.liquidity?.usd
  const rawLiquidityFinite = finite(rawLiquidity)
  const liquidity = n(rawLiquidity)
  const bondingCurveMarket = dexId === 'pumpfun'
  const liquidityReported = bondingCurveMarket
    ? rawLiquidityFinite && liquidity > 0
    : rawLiquidityFinite
  const liquidityUnavailable = !liquidityReported
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
  const liquidityRatio = liquidityReported && marketCap > 0 ? liquidity / marketCap : null
  const turnover24 = liquidityReported && liquidity > 0 ? volume24 / liquidity : null
  const volumeAcceleration = volume1 > 0 && volume6 > 0 ? (volume1 * 6) / volume6 : 1
  const microAcceleration = volume5 > 0 && volume1 > 0 ? (volume5 * 12) / volume1 : 1

  const symbol = String(pair?.baseToken?.symbol || '').toUpperCase()
  const name = String(pair?.baseToken?.name || '').toUpperCase()
  const stableSymbols = new Set(['USDC','USDT','PYUSD','USDS','USD1','USDE','FDUSD'])
  const stableAsset = stableSymbols.has(symbol) || name === 'USD COIN' || name === 'TETHER USD'

  if (stableAsset) {
    return {
      modelVersion: SCORE_VERSION, score: 50, setupScore: 50,
      executionScore: liquidity >= 100_000 ? 85 : 65, safetyScore: 90,
      dataQualityScore: 95, grade: 'N/A', signal: 'WATCH', confidence: 95,
      risk: 'LOWER', marketState: 'STABLE ASSET', preliminary: false,
      contractVerified: true, buyPercent24h: round(buyPct24),
      buyPercent1h: round(buyPct1), buyPercent5m: round(buyPct5),
      liquidityToCapPercent: liquidityReported ? round(liquidityRatio * 100, 2) : null,
      liquidityReported,
      liquiditySource: liquidityReported ? 'DEXSCREENER_AMM' : bondingCurveMarket ? 'PUMPFUN_BONDING_CURVE_UNREPORTED' : 'UNAVAILABLE',
      turnover24h: liquidityReported ? round(turnover24, 2) : null, volumeAcceleration: round(volumeAcceleration, 2),
      microAcceleration: round(microAcceleration, 2),
      ageHours: ageHours === null ? null : round(ageHours),
      riskFlags: ['STABLE_ASSET'],
      positives: ['Stable-value asset; directional trade signal suppressed'], negatives: [],
      breakdown: { liquidity:0, activity:0, orderFlow:0, momentum:0, maturity:0, contract:0, concentration:0 },
      scoring: { setupWeight:45, executionWeight:30, safetyWeight:25, meaning:'Risk-adjusted tradability score. Opportunity score is the setup/momentum axis. Neither is a probability of profit.' },
    }
  }

  const positives = []
  const negatives = []
  const riskFlags = []
  const breakdown = { liquidity:0, activity:0, orderFlow:0, momentum:0, maturity:0, contract:0, concentration:0 }

  let executionScore = 50
  if (liquidityUnavailable) {
    executionScore -= bondingCurveMarket ? 8 : 14
    breakdown.liquidity -= bondingCurveMarket ? 3 : 6
    negatives.push(
      bondingCurveMarket
        ? 'Pump.fun bonding-curve liquidity is not reported as AMM pool liquidity'
        : 'Liquidity data is unavailable'
    )
    riskFlags.push('LIQUIDITY_DATA_UNAVAILABLE')
  } else if (liquidity >= 500_000) {
    executionScore += 28; breakdown.liquidity += 15; positives.push('Deep execution liquidity')
  } else if (liquidity >= 150_000) {
    executionScore += 23; breakdown.liquidity += 13; positives.push('Strong execution liquidity')
  } else if (liquidity >= 50_000) {
    executionScore += 16; breakdown.liquidity += 9; positives.push('Healthy execution liquidity')
  } else if (liquidity >= 15_000) {
    executionScore += 7; breakdown.liquidity += 4
  } else if (liquidity >= 5_000) {
    executionScore -= 8; breakdown.liquidity -= 6; negatives.push('Liquidity is thin')
  } else {
    executionScore -= 28; breakdown.liquidity -= 18; negatives.push('Very low liquidity'); riskFlags.push('LOW_LIQUIDITY')
  }

  if (marketCap > 0 && liquidityReported) {
    if (liquidityRatio >= 0.20) {
      executionScore += 9; breakdown.liquidity += 4; positives.push('Strong liquidity relative to market cap')
    } else if (liquidityRatio >= 0.08) {
      executionScore += 4
    } else if (liquidityRatio < 0.02) {
      executionScore -= 15; breakdown.liquidity -= 8; negatives.push('Weak liquidity-to-market-cap ratio'); riskFlags.push('LOW_LIQUIDITY_RATIO')
    }
  }

  if (tx24 >= 300 && volume24 >= 25_000) {
    executionScore += 8; breakdown.activity += 5
  } else if (tx24 < 25 || volume24 < 2_500) {
    executionScore -= 12; breakdown.activity -= 7; negatives.push('Low trading depth'); riskFlags.push('LOW_ACTIVITY')
  }

  if (liquidityReported && turnover24 >= 0.5 && turnover24 <= 15) {
    executionScore += 7; breakdown.activity += 5; positives.push('Tradable volume relative to liquidity')
  } else if (liquidityReported && turnover24 > 60) {
    executionScore -= 7; breakdown.activity -= 3; negatives.push('Extreme turnover may include churn or bot activity'); riskFlags.push('EXTREME_TURNOVER')
  }
  executionScore = clamp(Math.round(executionScore), 0, 100)

  let setupScore = 50
  if (volumeAcceleration >= 1.35 && volumeAcceleration <= 3.5) {
    setupScore += 8; breakdown.activity += 5; positives.push('Hourly volume is accelerating')
  } else if (volumeAcceleration < 0.45) {
    setupScore -= 9; breakdown.activity -= 5; negatives.push('Hourly volume is fading')
  } else if (volumeAcceleration > 6) {
    setupScore -= 4; riskFlags.push('VOLUME_SPIKE')
  }

  if (microAcceleration >= 1.3 && microAcceleration <= 4 && volume5 >= 500) {
    setupScore += 4; breakdown.activity += 2
  } else if (microAcceleration < 0.3 && volume1 >= 1_000) {
    setupScore -= 4; breakdown.activity -= 2
  }

  if (tx24 >= 100) {
    if (buyPct24 >= 52 && buyPct24 <= 70) {
      setupScore += 7; breakdown.orderFlow += 5; positives.push('Constructive 24h buy pressure')
    } else if (buyPct24 < 38) {
      setupScore -= 13; breakdown.orderFlow -= 9; negatives.push('Sellers dominate 24h flow'); riskFlags.push('SELLER_DOMINANCE')
    } else if (buyPct24 > 86) {
      setupScore -= 5; breakdown.orderFlow -= 3; negatives.push('24h order flow is unusually one-sided'); riskFlags.push('EXTREME_BUY_IMBALANCE')
    }
  }

  if (tx1 >= 20) {
    if (buyPct1 >= 53 && buyPct1 <= 74) {
      setupScore += 10; breakdown.orderFlow += 6; positives.push('1h buyers are leading')
    } else if (buyPct1 < 38) {
      setupScore -= 15; breakdown.orderFlow -= 8; negatives.push('1h sellers are leading'); riskFlags.push('RECENT_SELL_PRESSURE')
    } else if (buyPct1 > 84) {
      setupScore -= 5; breakdown.orderFlow -= 2; riskFlags.push('ONE_SIDED_1H_FLOW')
    }
  }

  if (tx5 >= 8 && buyPct5 < 30) {
    setupScore -= 6; breakdown.orderFlow -= 3; negatives.push('5m flow is seller-heavy')
  }

  if (change24 >= 3 && change24 <= 100) {
    setupScore += 5; breakdown.momentum += 4
  } else if (change24 < -25) {
    setupScore -= 10; breakdown.momentum -= 7; negatives.push('24h trend is weak')
  }

  if (change6 >= 1 && change6 <= 45) {
    setupScore += 9; breakdown.momentum += 5; positives.push('6h structure is constructive')
  } else if (change6 < -18) {
    setupScore -= 14; breakdown.momentum -= 8; negatives.push('6h momentum is bearish'); riskFlags.push('BEARISH_6H')
  }

  if (change1 >= 0.5 && change1 <= 18) {
    setupScore += 10; breakdown.momentum += 5; positives.push('1h momentum is positive')
  } else if (change1 < -9) {
    setupScore -= 14; breakdown.momentum -= 7; negatives.push('1h momentum is deteriorating'); riskFlags.push('BEARISH_1H')
  }

  if (change5 >= -2 && change5 <= 8) {
    setupScore += 3
  } else if (change5 < -10) {
    setupScore -= 7; breakdown.momentum -= 3; negatives.push('5m momentum is sharply negative')
  }

  const parabolic = change24 > 220 || change6 > 100 || change1 > 45 || change5 > 25
  if (parabolic) {
    setupScore -= 20; breakdown.momentum -= 11; negatives.push('Price is extended; chase risk is elevated'); riskFlags.push('PARABOLIC_MOVE')
  }

  const timeframeSigns = [change5, change1, change6, change24].map((value) => value > 1 ? 1 : value < -1 ? -1 : 0)
  const positiveFrames = timeframeSigns.filter((value) => value > 0).length
  const negativeFrames = timeframeSigns.filter((value) => value < 0).length
  if (positiveFrames >= 3) {
    setupScore += 5; positives.push('Momentum agrees across multiple timeframes')
  } else if (positiveFrames >= 2 && negativeFrames >= 2) {
    setupScore -= 6; negatives.push('Momentum is conflicting across timeframes'); riskFlags.push('TIMEFRAME_CONFLICT')
  }
  setupScore = clamp(Math.round(setupScore), 0, 100)

  let safetyScore = mintSecurity?.available ? 66 : 55
  if (ageHours !== null) {
    if (ageHours < 0.25) {
      safetyScore -= 24; breakdown.maturity -= 10; negatives.push('Pair is less than 15 minutes old'); riskFlags.push('VERY_NEW_PAIR')
    } else if (ageHours < 1) {
      safetyScore -= 15; breakdown.maturity -= 6; negatives.push('Pair is less than one hour old'); riskFlags.push('NEW_PAIR')
    } else if (ageHours < 3) {
      safetyScore -= 7; breakdown.maturity -= 2
    } else if (ageHours >= 24) {
      safetyScore += 8; breakdown.maturity += 4; positives.push('Pair has survived beyond 24 hours')
    }
    if (ageHours >= 168) safetyScore += 3
  }

  if (mintSecurity?.available) {
    if (mintSecurity.mintAuthority) {
      safetyScore -= 32; breakdown.contract -= 12; negatives.push('Mint authority is still active'); riskFlags.push('MINT_AUTHORITY_ACTIVE')
    } else {
      safetyScore += 9; breakdown.contract += 4; positives.push('Mint authority is disabled')
    }
    if (mintSecurity.freezeAuthority) {
      safetyScore -= 28; breakdown.contract -= 11; negatives.push('Freeze authority is still active'); riskFlags.push('FREEZE_AUTHORITY_ACTIVE')
    } else {
      safetyScore += 9; breakdown.contract += 4; positives.push('Freeze authority is disabled')
    }
  }

  const accountTop1 = finite(mintSecurity?.top1Percent) ? Number(mintSecurity.top1Percent) : null
  const accountTop5 = finite(mintSecurity?.top5Percent) ? Number(mintSecurity.top5Percent) : null
  const accountTop10 = finite(mintSecurity?.top10Percent) ? Number(mintSecurity.top10Percent) : null
  const ownerTop1 = finite(mintSecurity?.top1OwnerPercent) ? Number(mintSecurity.top1OwnerPercent) : null
  const ownerTop5 = finite(mintSecurity?.top5OwnerPercent) ? Number(mintSecurity.top5OwnerPercent) : null
  const ownerTop10 = finite(mintSecurity?.top10OwnerPercent) ? Number(mintSecurity.top10OwnerPercent) : null
  const ownerConcentrationAvailable = Boolean(mintSecurity?.ownerConcentrationAvailable)
  const concentrationAvailable = ownerConcentrationAvailable || Boolean(mintSecurity?.concentrationAvailable)
  const concentrationMethod = ownerConcentrationAvailable ? 'RESOLVED_TOKEN_ACCOUNT_OWNERS' :
    mintSecurity?.concentrationAvailable ? 'TOKEN_ACCOUNTS' : 'UNAVAILABLE'
  const top1 = ownerConcentrationAvailable ? ownerTop1 : accountTop1
  const top5 = ownerConcentrationAvailable ? ownerTop5 : accountTop5
  const top10 = ownerConcentrationAvailable ? ownerTop10 : accountTop10

  if (concentrationAvailable) {
    if (top1 !== null && top1 >= 70) {
      safetyScore -= 30
      breakdown.concentration -= 12
      negatives.push(ownerConcentrationAvailable
        ? 'Largest resolved token-account owner controls an extreme share of supply'
        : 'Largest token account controls an extreme share of supply')
      riskFlags.push(ownerConcentrationAvailable ? 'EXTREME_OWNER_CONCENTRATION' : 'EXTREME_ACCOUNT_CONCENTRATION')
    } else if (top1 !== null && top1 >= 45) {
      safetyScore -= 16
      breakdown.concentration -= 6
      negatives.push(ownerConcentrationAvailable
        ? 'Resolved owner concentration is elevated'
        : 'Largest token account concentration is elevated')
      riskFlags.push(ownerConcentrationAvailable ? 'HIGH_OWNER_CONCENTRATION' : 'HIGH_ACCOUNT_CONCENTRATION')
    } else if (top1 !== null && top1 <= 20) {
      safetyScore += 5
      breakdown.concentration += 2
    }

    if (top10 !== null && top10 >= 92) {
      safetyScore -= 12
      breakdown.concentration -= 5
      negatives.push(ownerConcentrationAvailable
        ? 'Top resolved token-account owners control most of the supply'
        : 'Top token accounts hold most of the supply')
      riskFlags.push(ownerConcentrationAvailable ? 'TOP10_OWNER_CONCENTRATION' : 'TOP10_CONCENTRATION')
    } else if (top10 !== null && top10 <= 65) {
      safetyScore += 5
      breakdown.concentration += 2
      positives.push(ownerConcentrationAvailable
        ? 'Resolved owner concentration is comparatively distributed'
        : 'Token-account concentration is comparatively distributed')
    }
  }
  safetyScore = clamp(Math.round(safetyScore), 0, 100)

  const contractVerified = Boolean(mintSecurity?.available) && !mintSecurity?.mintAuthority && !mintSecurity?.freezeAuthority

  let dataQualityScore = 35
  if (liquidity > 0 && marketCap > 0) dataQualityScore += 12
  if (volume24 > 0 && volume1 > 0) dataQualityScore += 12
  if (tx24 >= 50) dataQualityScore += 10
  if (tx1 >= 10) dataQualityScore += 8
  if (ageHours !== null) dataQualityScore += 6
  if (mintSecurity?.available) dataQualityScore += 10
  if (concentrationAvailable) dataQualityScore += 7
  dataQualityScore = clamp(Math.round(dataQualityScore), 25, 100)

  let score = Math.round(setupScore * 0.45 + executionScore * 0.30 + safetyScore * 0.25)

  const contractDanger = riskFlags.includes('MINT_AUTHORITY_ACTIVE') || riskFlags.includes('FREEZE_AUTHORITY_ACTIVE')
  const concentrationDanger =
    riskFlags.includes('EXTREME_OWNER_CONCENTRATION') ||
    riskFlags.includes('EXTREME_ACCOUNT_CONCENTRATION')
  const collapseDanger = change24 < -45 || change6 < -35
  const sellerDanger = (buyPct24 < 34 && tx24 >= 40) || (buyPct1 < 32 && tx1 >= 15)
  const shortTermWeakness = change1 < -10 || change6 < -18
  const newborn = ageHours !== null && ageHours < 0.25

  if (safetyScore < 35) score = Math.min(score, 39)
  if (executionScore < 35) score = Math.min(score, 42)
  if (setupScore < 35) score = Math.min(score, 46)
  if (contractDanger) score = Math.min(score, 34)
  if (concentrationDanger) score = Math.min(score, 38)
  if (collapseDanger) score = Math.min(score, 45)
  if (sellerDanger) score = Math.min(score, 48)
  if (parabolic) score = Math.min(score, 64)
  if (shortTermWeakness) score = Math.min(score, 62)
  if (newborn) score = Math.min(score, 54)
  if (!contractVerified) score = Math.min(score, 80)
  score = clamp(Math.round(score), 0, 100)

  const confidence = clamp(
    Math.round(dataQualityScore * 0.72 + Math.min(28, Math.log10(Math.max(1, tx24)) * 7)),
    25, 96
  )

  // Keep structural/rug danger separate from directional opportunity.
  // Thin liquidity, a very young pair, or a parabolic move can make execution
  // extremely risky without proving that price direction is bearish.
  const hotMomentum =
    setupScore >= 60 &&
    !collapseDanger &&
    !sellerDanger &&
    (
      (tx1 >= 10 && buyPct1 >= 50) ||
      (tx5 >= 6 && buyPct5 >= 50) ||
      volumeAcceleration >= 1.25
    )

  let signal = 'WATCH'
  if (contractDanger || concentrationDanger || safetyScore < 25) {
    signal = 'SELL / AVOID'
  } else if (collapseDanger || sellerDanger || setupScore < 32) {
    signal = 'REDUCE'
  } else {
    const entryStructure =
      setupScore >= 64 && executionScore >= 52 && safetyScore >= 52 &&
      change1 >= -5 && change6 >= -8 && change24 >= -18 && change24 <= 150 &&
      buyPct1 >= 46 && buyPct1 <= 80 && !parabolic && !newborn

    if (score >= 80 && setupScore >= 76 && executionScore >= 65 && safetyScore >= 70 &&
        confidence >= 65 && entryStructure && contractVerified) {
      signal = 'BUY SETUP'
    } else if (score >= 69 && setupScore >= 64 && executionScore >= 52 && entryStructure) {
      signal = 'LEAN BUY'
    }
  }

  if (signal === 'SELL / AVOID') score = Math.min(score, 37)
  else if (signal === 'REDUCE') score = Math.min(score, 49)
  else if (signal === 'WATCH') score = Math.min(score, 74)
  else if (signal === 'LEAN BUY') score = clamp(score, 69, 84)

  let risk = 'MODERATE'
  if (safetyScore >= 78 && executionScore >= 65 && riskFlags.length === 0) risk = 'LOWER'
  if (score < 60 || safetyScore < 55 || executionScore < 45 || riskFlags.length >= 2 || parabolic || shortTermWeakness || sellerDanger) risk = 'HIGH'
  if (score < 40 || safetyScore < 35 || executionScore < 25 || riskFlags.length >= 4 || contractDanger || concentrationDanger) risk = 'EXTREME'

  let directionalBias = 'NEUTRAL'
  if (collapseDanger || sellerDanger || setupScore < 40) directionalBias = 'BEARISH'
  else if (setupScore >= 60 && !shortTermWeakness) directionalBias = 'BULLISH'

  let opportunityLabel = 'MIXED'
  if (setupScore >= 76) opportunityLabel = 'STRONG MOMENTUM'
  else if (setupScore >= 60) opportunityLabel = 'MOMENTUM BUILDING'
  else if (setupScore < 40) opportunityLabel = 'WEAK'
  if (hotMomentum && (risk === 'HIGH' || risk === 'EXTREME')) opportunityLabel = 'HOT / HIGH RISK'
  if (contractDanger || concentrationDanger) opportunityLabel = 'STRUCTURAL DANGER'

  let marketState = 'BALANCED'
  if (collapseDanger || sellerDanger) marketState = 'DETERIORATING'
  else if (signal === 'BUY SETUP') marketState = 'STRONG SETUP'
  else if (signal === 'LEAN BUY') marketState = 'CONSTRUCTIVE'
  else if (hotMomentum && (executionScore < 52 || newborn || parabolic)) marketState = 'HOT / HIGH RISK'
  else if (parabolic) marketState = 'EXTENDED'
  else if (shortTermWeakness) marketState = 'WEAKENING'

  // Deterministic market-cap scenario zones. These are deliberately derived
  // from current market cap + observed price movement + risk, not random targets.
  // Chart-based support/resistance can replace these estimates in the Market Lab.
  let marketCapPlan = { available:false, basis:'unavailable' }
  if (marketCap > 0) {
    const volatilityAnchor = clamp(
      Math.max(
        6,
        Math.abs(change5),
        Math.abs(change1) * 0.6,
        Math.abs(change6) * 0.25,
      ),
      6,
      35,
    )
    const riskFactor =
      risk === 'EXTREME' ? 1.35 :
      risk === 'HIGH' ? 1.15 :
      risk === 'LOWER' ? 0.80 : 0.95

    const pullbackPct = clamp(volatilityAnchor * riskFactor, 5, 30)
    const invalidationPct = clamp(volatilityAnchor * riskFactor * 1.45, 10, 45)
    const bullishFactor = directionalBias === 'BULLISH' ? 1 : directionalBias === 'BEARISH' ? 0.68 : 0.82
    const breakoutPct = clamp(volatilityAnchor * 0.55 * bullishFactor, 5, 20)
    const trimPct = clamp(volatilityAnchor * 1.0 * bullishFactor, 10, 35)
    const targetPct = clamp(volatilityAnchor * 1.8 * bullishFactor, 20, 70)
    const stretchPct = clamp(volatilityAnchor * 2.8 * bullishFactor, 35, 120)
    const structureVeto = contractDanger || concentrationDanger

    const entryLowDiscount =
      signal === 'REDUCE' ? clamp(pullbackPct * 1.25, 8, 36) :
      signal === 'WATCH' ? pullbackPct :
      clamp(pullbackPct * 0.75, 4, 20)
    const entryHighDiscount =
      signal === 'BUY SETUP' ? clamp(pullbackPct * 0.10, 0, 3) :
      signal === 'LEAN BUY' ? clamp(pullbackPct * 0.25, 1, 6) :
      clamp(pullbackPct * 0.48, 3, 16)

    const mc = (percent) => Math.max(0, Math.round(marketCap * (1 + percent / 100)))

    marketCapPlan = {
      available:true,
      basis:'recent-volatility-and-risk-scenario',
      current:Math.round(marketCap),
      action:structureVeto
        ? 'NO ENTRY — STRUCTURAL RISK'
        : signal === 'BUY SETUP'
          ? 'ENTRY / SCALE'
          : signal === 'LEAN BUY'
            ? 'LEAN ENTRY'
            : signal === 'REDUCE'
              ? 'WAIT FOR DEEPER RESET'
              : hotMomentum
                ? 'PULLBACK ENTRY ONLY'
                : 'WATCH / PULLBACK',
      entryLow:structureVeto ? null : mc(-entryLowDiscount),
      entryHigh:structureVeto ? null : mc(-entryHighDiscount),
      breakout:structureVeto ? null : mc(breakoutPct),
      trim1:structureVeto ? null : mc(trimPct),
      target2:structureVeto ? null : mc(targetPct),
      stretch:structureVeto ? null : mc(stretchPct),
      invalidation:mc(-invalidationPct),
      volatilityAnchorPercent:round(volatilityAnchor,1),
      note:structureVeto
        ? 'Hard contract/concentration danger vetoes entry-zone estimates.'
        : 'Scenario zones are derived from current market cap, recent volatility, direction and risk; they are not guaranteed targets.',
    }
  }

  return {
    modelVersion: SCORE_VERSION, score, setupScore, executionScore, safetyScore, dataQualityScore,
    opportunityScore: setupScore, opportunityLabel, directionalBias, hotMomentum, marketCapPlan,
    grade: score >= 86 ? 'A' : score >= 76 ? 'B' : score >= 64 ? 'C' : score >= 50 ? 'D' : 'F',
    signal, confidence, risk, marketState,
    buyPercent24h: round(buyPct24), buyPercent1h: round(buyPct1), buyPercent5m: round(buyPct5),
    liquidityToCapPercent: liquidityReported ? round(liquidityRatio * 100, 2) : null,
    liquidityReported,
    liquiditySource: liquidityReported ? 'DEXSCREENER_AMM' : bondingCurveMarket ? 'PUMPFUN_BONDING_CURVE_UNREPORTED' : 'UNAVAILABLE',
    turnover24h: liquidityReported ? round(turnover24, 2) : null,
    volumeAcceleration: round(volumeAcceleration, 2), microAcceleration: round(microAcceleration, 2),
    ageHours: ageHours === null ? null : round(ageHours), contractVerified,
    preliminary: !contractVerified,
    concentration: {
      available:concentrationAvailable,
      method:concentrationMethod,
      top1Percent:top1,
      top5Percent:top5,
      top10Percent:top10,
      accountTop1Percent:accountTop1,
      accountTop5Percent:accountTop5,
      accountTop10Percent:accountTop10,
      ownerTop1Percent:ownerTop1,
      ownerTop5Percent:ownerTop5,
      ownerTop10Percent:ownerTop10,
      uniqueResolvedOwners:Number(mintSecurity?.uniqueResolvedOwners || 0),
    },
    scoring: { setupWeight:45, executionWeight:30, safetyWeight:25, meaning:'Risk-adjusted setup score, not a probability of profit' },
    riskFlags:[...new Set(riskFlags)], positives:[...new Set(positives)].slice(0,8),
    negatives:[...new Set(negatives)].slice(0,8), breakdown,
  }
}
