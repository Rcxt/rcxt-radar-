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

export const SCORE_VERSION = '6.1.0'

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
  const priceReported = finite(pair?.priceUsd) && Number(pair.priceUsd) > 0
  const rawLiquidity = pair?.liquidity?.usd
  const rawLiquidityFinite = finite(rawLiquidity)
  const liquidity = n(rawLiquidity)
  const bondingCurveMarket = dexId === 'pumpfun'
  const liquidityReported = bondingCurveMarket
    ? rawLiquidityFinite && liquidity > 0
    : rawLiquidityFinite
  const liquidityUnavailable = !liquidityReported
  const reportedMarketCap = n(pair?.marketCap)
  const fdv = n(pair?.fdv)
  const marketCap = reportedMarketCap || fdv
  const valuationBasis = reportedMarketCap > 0 ? 'MARKET_CAP' : fdv > 0 ? 'FDV' : 'UNAVAILABLE'
  const volume24Reported = finite(pair?.volume?.h24)
  const volume6Reported = finite(pair?.volume?.h6)
  const volume1Reported = finite(pair?.volume?.h1)
  const volume5Reported = finite(pair?.volume?.m5)
  const change24Reported = finite(pair?.priceChange?.h24)
  const change6Reported = finite(pair?.priceChange?.h6)
  const change1Reported = finite(pair?.priceChange?.h1)
  const change5Reported = finite(pair?.priceChange?.m5)
  const flow24Reported = finite(pair?.txns?.h24?.buys) && finite(pair?.txns?.h24?.sells)
  const flow1Reported = finite(pair?.txns?.h1?.buys) && finite(pair?.txns?.h1?.sells)
  const flow5Reported = finite(pair?.txns?.m5?.buys) && finite(pair?.txns?.m5?.sells)

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
  const volumeAcceleration = volume1Reported && volume6Reported && volume1 > 0 && volume6 > 0
    ? (volume1 * 6) / volume6
    : null
  const microAcceleration = volume5Reported && volume1Reported && volume5 > 0 && volume1 > 0
    ? (volume5 * 12) / volume1
    : null

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
  if (volumeAcceleration !== null && volumeAcceleration >= 1.35 && volumeAcceleration <= 3.5) {
    setupScore += 8; breakdown.activity += 5; positives.push('Hourly volume is accelerating')
  } else if (volumeAcceleration !== null && volumeAcceleration < 0.45) {
    setupScore -= 9; breakdown.activity -= 5; negatives.push('Hourly volume is fading')
  } else if (volumeAcceleration !== null && volumeAcceleration > 6) {
    setupScore -= 4; riskFlags.push('VOLUME_SPIKE')
  }

  if (microAcceleration !== null && microAcceleration >= 1.3 && microAcceleration <= 4 && volume5 >= 500) {
    setupScore += 4; breakdown.activity += 2
  } else if (microAcceleration !== null && microAcceleration < 0.3 && volume1 >= 1_000) {
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

  if (change24Reported && change24 >= 3 && change24 <= 100) {
    setupScore += 5; breakdown.momentum += 4
  } else if (change24Reported && change24 < -25) {
    setupScore -= 10; breakdown.momentum -= 7; negatives.push('24h trend is weak')
  }

  if (change6Reported && change6 >= 1 && change6 <= 45) {
    setupScore += 9; breakdown.momentum += 5; positives.push('6h structure is constructive')
  } else if (change6Reported && change6 < -18) {
    setupScore -= 14; breakdown.momentum -= 8; negatives.push('6h momentum is bearish'); riskFlags.push('BEARISH_6H')
  }

  if (change1Reported && change1 >= 0.5 && change1 <= 18) {
    setupScore += 10; breakdown.momentum += 5; positives.push('1h momentum is positive')
  } else if (change1Reported && change1 < -9) {
    setupScore -= 14; breakdown.momentum -= 7; negatives.push('1h momentum is deteriorating'); riskFlags.push('BEARISH_1H')
  }

  if (change5Reported && change5 >= -2 && change5 <= 8) {
    setupScore += 3
  } else if (change5Reported && change5 < -10) {
    setupScore -= 7; breakdown.momentum -= 3; negatives.push('5m momentum is sharply negative')
  }

  const parabolic =
    (change24Reported && change24 > 220) ||
    (change6Reported && change6 > 100) ||
    (change1Reported && change1 > 45) ||
    (change5Reported && change5 > 25)
  if (parabolic) {
    setupScore -= 20; breakdown.momentum -= 11; negatives.push('Price is extended; chase risk is elevated'); riskFlags.push('PARABOLIC_MOVE')
  }

  const timeframeSigns = [
    [change5Reported,change5],
    [change1Reported,change1],
    [change6Reported,change6],
    [change24Reported,change24],
  ].map(([reported,value]) => !reported ? null : value > 1 ? 1 : value < -1 ? -1 : 0)
  const positiveFrames = timeframeSigns.filter((value) => value !== null && value > 0).length
  const negativeFrames = timeframeSigns.filter((value) => value !== null && value < 0).length
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

  const evmSecurity = mintSecurity?.securityModel === 'evm-token'

  if (mintSecurity?.available && !evmSecurity) {
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

  const token2022 = mintSecurity?.token2022 === true
  const transferFeeEnabled = mintSecurity?.transferFeeEnabled === true
  const transferFeeBasisPoints = finite(mintSecurity?.transferFeeBasisPoints)
    ? Number(mintSecurity.transferFeeBasisPoints)
    : null
  const permanentDelegateActive = Boolean(mintSecurity?.permanentDelegate)
  const transferHookActive = Boolean(mintSecurity?.transferHookProgramId)
  const defaultAccountFrozen = mintSecurity?.defaultAccountFrozen === true
  const nonTransferable = mintSecurity?.nonTransferable === true
  const pauseAuthorityActive = Boolean(mintSecurity?.pauseAuthority)
  const tokenPaused = mintSecurity?.paused === true
  const mintCloseAuthorityActive = Boolean(mintSecurity?.mintCloseAuthority)

  if (transferFeeEnabled) {
    const feePenalty =
      transferFeeBasisPoints !== null && transferFeeBasisPoints >= 1000 ? 16 :
      transferFeeBasisPoints !== null && transferFeeBasisPoints >= 500 ? 11 :
      transferFeeBasisPoints !== null && transferFeeBasisPoints > 0 ? 6 : 4
    executionScore = clamp(executionScore - feePenalty, 0, 100)
    safetyScore -= Math.ceil(feePenalty / 2)
    negatives.push(
      transferFeeBasisPoints !== null
        ? `Token-2022 transfer fee is configured at ${transferFeeBasisPoints / 100}%`
        : 'Token-2022 transfer fee is enabled'
    )
    riskFlags.push('TOKEN2022_TRANSFER_FEE')
  }

  if (permanentDelegateActive) {
    safetyScore -= 32
    breakdown.contract -= 12
    negatives.push('Token-2022 permanent delegate can transfer or burn holder tokens')
    riskFlags.push('PERMANENT_DELEGATE_ACTIVE')
  }

  if (transferHookActive) {
    safetyScore -= 10
    executionScore = clamp(executionScore - 7, 0, 100)
    breakdown.contract -= 4
    negatives.push('Token-2022 transfer hook executes custom logic on every transfer')
    riskFlags.push('TRANSFER_HOOK_ACTIVE')
  }

  if (defaultAccountFrozen) {
    safetyScore -= 38
    breakdown.contract -= 14
    negatives.push('New Token-2022 accounts default to frozen')
    riskFlags.push('DEFAULT_ACCOUNT_FROZEN')
  }

  if (nonTransferable) {
    safetyScore -= 70
    executionScore = clamp(executionScore - 70, 0, 100)
    breakdown.contract -= 20
    negatives.push('Token-2022 mint is non-transferable')
    riskFlags.push('NON_TRANSFERABLE_TOKEN')
  }

  if (tokenPaused) {
    safetyScore -= 70
    executionScore = clamp(executionScore - 70, 0, 100)
    breakdown.contract -= 20
    negatives.push('Token-2022 mint is currently paused')
    riskFlags.push('TOKEN_PAUSED')
  } else if (pauseAuthorityActive) {
    safetyScore -= 12
    breakdown.contract -= 4
    negatives.push('Token-2022 pause authority is active')
    riskFlags.push('PAUSE_AUTHORITY_ACTIVE')
  }

  if (mintCloseAuthorityActive) {
    safetyScore -= 6
    breakdown.contract -= 2
    negatives.push('Token-2022 mint close authority is active')
    riskFlags.push('MINT_CLOSE_AUTHORITY_ACTIVE')
  }

  const externalEvidence = mintSecurity?.external || {}
  const externalHardFlags = Array.isArray(externalEvidence?.hardRiskFlags) ? externalEvidence.hardRiskFlags : []
  const externalSoftFlags = Array.isArray(externalEvidence?.softRiskFlags) ? externalEvidence.softRiskFlags : []
  const securityDataConflicts = Array.isArray(externalEvidence?.dataConflicts) ? externalEvidence.dataConflicts : []
  const externalProviderCount = n(externalEvidence?.providerCount)
  const externalDangerRiskCount = n(externalEvidence?.dangerRiskCount)
  const externalWarningRiskCount = n(externalEvidence?.warningRiskCount)
  const ruggedExternal = externalEvidence?.rugged === true
  const marketEvidence = externalEvidence?.market || {}
  const marketPriceConflict = marketEvidence?.priceConflict === true
  const marketPriceAgreement = marketEvidence?.priceAgreement === true
  const marketLiquidityConflict = marketEvidence?.liquidityConflict === true
  const marketCapConflict = marketEvidence?.marketCapConflict === true
  const externalPriceProviderCount = n(marketEvidence?.externalPriceProviderCount)
  const authorityConflict =
    securityDataConflicts.includes('MINT_AUTHORITY_CONFLICT') ||
    securityDataConflicts.includes('FREEZE_AUTHORITY_CONFLICT')
  const externalAuthorityActive =
    externalHardFlags.includes('MINT_AUTHORITY_ACTIVE_EXTERNAL') ||
    externalHardFlags.includes('FREEZE_AUTHORITY_ACTIVE_EXTERNAL')
  const providerStructuralDanger =
    externalHardFlags.includes('RUGCHECK_STRUCTURAL_DANGER') ||
    externalHardFlags.includes('GOPLUS_DEFAULT_FROZEN') ||
    externalHardFlags.includes('GOPLUS_HONEYPOT') ||
    externalHardFlags.includes('GOPLUS_CANNOT_BUY') ||
    externalHardFlags.includes('GOPLUS_MALICIOUS_TOKEN') ||
    externalHardFlags.includes('GOPLUS_OWNER_CHANGE_BALANCE') ||
    externalHardFlags.includes('GOPLUS_HIDDEN_OWNER') ||
    externalHardFlags.includes('GOPLUS_SELFDESTRUCT') ||
    externalHardFlags.includes('GOPLUS_GAS_ABUSE')
  const externalStructuralDanger =
    ruggedExternal ||
    providerStructuralDanger ||
    (
      externalAuthorityActive &&
      !mintSecurity?.available
    )

  const insiderPercent = finite(externalEvidence?.insiderPercent)
    ? Number(externalEvidence.insiderPercent)
    : null
  const jupiterOrganicScore = finite(externalEvidence?.jupiterOrganicScore)
    ? Number(externalEvidence.jupiterOrganicScore)
    : null
  const creatorPercent = finite(externalEvidence?.creatorPercent)
    ? Number(externalEvidence.creatorPercent)
    : null
  const jupiterSuspicious = externalEvidence?.jupiterSuspicious === true
  const goPlusEvidence = externalEvidence?.goplus || {}
  const evmBuyTaxPercent = finite(goPlusEvidence?.buyTaxPercent) ? Number(goPlusEvidence.buyTaxPercent) : null
  const evmSellTaxPercent = finite(goPlusEvidence?.sellTaxPercent) ? Number(goPlusEvidence.sellTaxPercent) : null
  const evmOpenSource = typeof goPlusEvidence?.openSource === 'boolean' ? goPlusEvidence.openSource : null
  const evmProxy = goPlusEvidence?.proxy === true
  const evmMintable = goPlusEvidence?.mintable === true
  const evmTakeBackOwnership = goPlusEvidence?.takeBackOwnership === true
  const evmTransferPausable = goPlusEvidence?.transferPausable === true
  const evmBlacklistCapability = goPlusEvidence?.blacklistActive === true
  const evmCannotSellAll = goPlusEvidence?.cannotSellAll === true
  const evmTradingCooldown = goPlusEvidence?.tradingCooldown === true
  const evmExternalCall = goPlusEvidence?.externalCall === true
  const evmSlippageModifiable = goPlusEvidence?.slippageModifiable === true
  const evmPersonalSlippageModifiable = goPlusEvidence?.personalSlippageModifiable === true
  const evmAntiWhale = goPlusEvidence?.antiWhale === true
  const evmAntiWhaleModifiable = goPlusEvidence?.antiWhaleModifiable === true
  const evmOwnerPercent = finite(goPlusEvidence?.ownerPercent) ? Number(goPlusEvidence.ownerPercent) : null

  if (evmSecurity) {
    if (mintSecurity?.available && mintSecurity?.contractCodePresent === false) {
      safetyScore -= 55
      breakdown.contract -= 20
      negatives.push('No contract bytecode was found at this EVM address')
      riskFlags.push('EVM_NO_CONTRACT_CODE')
    }

    if (goPlusEvidence?.available) {
      if (evmOpenSource === false) {
        safetyScore -= 16
        breakdown.contract -= 6
        negatives.push('GoPlus reports the EVM contract is not open source')
        riskFlags.push('EVM_CLOSED_SOURCE')
      } else if (evmOpenSource === true && !providerStructuralDanger) {
        positives.push('EVM contract source is available for inspection')
      }

      if (evmProxy) {
        safetyScore -= 8
        breakdown.contract -= 3
        negatives.push('EVM token uses a proxy contract and can depend on an upgradeable implementation')
        riskFlags.push('EVM_PROXY_CONTRACT')
      }
      if (evmMintable) {
        safetyScore -= 14
        breakdown.contract -= 5
        negatives.push('EVM token supply can be minted')
        riskFlags.push('EVM_MINTABLE')
      }
      if (evmTakeBackOwnership) {
        safetyScore -= 16
        breakdown.contract -= 6
        negatives.push('EVM ownership can be reclaimed after renouncement')
        riskFlags.push('EVM_OWNERSHIP_RECLAIMABLE')
      }
      if (evmTransferPausable) {
        safetyScore -= 12
        executionScore = clamp(executionScore - 5, 0, 100)
        breakdown.contract -= 4
        negatives.push('EVM contract can pause transfers or trading')
        riskFlags.push('EVM_TRANSFER_PAUSABLE')
      }
      if (evmBlacklistCapability) {
        safetyScore -= 10
        executionScore = clamp(executionScore - 4, 0, 100)
        breakdown.contract -= 3
        negatives.push('EVM contract contains address-blacklisting controls')
        riskFlags.push('EVM_BLACKLIST_CAPABILITY')
      }
      if (evmCannotSellAll) {
        safetyScore -= 5
        executionScore = clamp(executionScore - 9, 0, 100)
        negatives.push('EVM token may require holders to retain part of their balance when selling')
        riskFlags.push('EVM_CANNOT_SELL_ALL')
      }
      if (evmTradingCooldown) {
        safetyScore -= 3
        executionScore = clamp(executionScore - 6, 0, 100)
        negatives.push('EVM contract applies a trading cooldown')
        riskFlags.push('EVM_TRADING_COOLDOWN')
      }
      if (evmSlippageModifiable) {
        safetyScore -= 12
        executionScore = clamp(executionScore - 8, 0, 100)
        breakdown.contract -= 4
        negatives.push('EVM contract owner can modify token trading taxes')
        riskFlags.push('EVM_MODIFIABLE_TAX')
      }
      if (evmPersonalSlippageModifiable) {
        safetyScore -= 18
        executionScore = clamp(executionScore - 10, 0, 100)
        breakdown.contract -= 6
        negatives.push('EVM contract can assign address-specific trading taxes')
        riskFlags.push('EVM_PERSONAL_TAX_CONTROL')
      }
      if (evmAntiWhale) {
        executionScore = clamp(executionScore - 4, 0, 100)
        riskFlags.push('EVM_ANTI_WHALE')
      }
      if (evmAntiWhaleModifiable) {
        safetyScore -= 6
        executionScore = clamp(executionScore - 5, 0, 100)
        negatives.push('EVM transaction/position limits can be modified')
        riskFlags.push('EVM_MODIFIABLE_ANTI_WHALE')
      }
      if (evmExternalCall) {
        safetyScore -= 4
        negatives.push('EVM transfer behavior depends on external contract calls')
        riskFlags.push('EVM_EXTERNAL_CALL')
      }
      if (evmOwnerPercent !== null) {
        if (evmOwnerPercent >= 20) {
          safetyScore -= 20
          breakdown.concentration -= 7
          negatives.push('EVM contract owner holds a very high share of supply')
          riskFlags.push('HIGH_OWNER_TOKEN_SHARE')
        } else if (evmOwnerPercent >= 10) {
          safetyScore -= 10
          breakdown.concentration -= 4
          negatives.push('EVM contract owner holds an elevated share of supply')
          riskFlags.push('ELEVATED_OWNER_TOKEN_SHARE')
        }
      }

      const maxTax = Math.max(evmBuyTaxPercent || 0, evmSellTaxPercent || 0)
      if (maxTax >= 50) {
        executionScore = clamp(executionScore - 32, 0, 100)
        safetyScore -= 20
        negatives.push(`EVM token tax is extremely high (buy ${round(evmBuyTaxPercent || 0,1)}% / sell ${round(evmSellTaxPercent || 0,1)}%)`)
        riskFlags.push('EVM_EXTREME_TAX')
      } else if (maxTax >= 20) {
        executionScore = clamp(executionScore - 20, 0, 100)
        safetyScore -= 10
        negatives.push(`EVM token tax is high (buy ${round(evmBuyTaxPercent || 0,1)}% / sell ${round(evmSellTaxPercent || 0,1)}%)`)
        riskFlags.push('EVM_HIGH_TAX')
      } else if (maxTax >= 10) {
        executionScore = clamp(executionScore - 10, 0, 100)
        safetyScore -= 4
        negatives.push(`EVM token tax is elevated (buy ${round(evmBuyTaxPercent || 0,1)}% / sell ${round(evmSellTaxPercent || 0,1)}%)`)
        riskFlags.push('EVM_ELEVATED_TAX')
      }
    }
  }

  if (ruggedExternal) {
    safetyScore -= 65
    breakdown.contract -= 20
    negatives.push('Independent security source reports this token as rugged')
    riskFlags.push('EXTERNAL_RUGGED')
  } else if (externalStructuralDanger) {
    safetyScore -= 30
    breakdown.contract -= 10
    negatives.push('Independent security evidence reports a structural token risk')
    riskFlags.push('EXTERNAL_STRUCTURAL_DANGER')
  }

  if (externalDangerRiskCount > 0) {
    safetyScore -= Math.min(18, externalDangerRiskCount * 6)
    negatives.push(`${externalDangerRiskCount} external danger-level security finding${externalDangerRiskCount === 1 ? '' : 's'}`)
    riskFlags.push('EXTERNAL_DANGER_FINDINGS')
  }

  if (jupiterSuspicious) {
    safetyScore -= 16
    breakdown.contract -= 5
    negatives.push('Jupiter flags this token as suspicious')
    riskFlags.push('JUPITER_SUSPICIOUS')
  }

  const mutableMetadata =
    externalSoftFlags.includes('GOPLUS_METADATA_MUTABLE') ||
    externalSoftFlags.includes('BIRDEYE_METADATA_MUTABLE')
  if (mutableMetadata) {
    safetyScore -= 7
    breakdown.contract -= 2
    negatives.push('External security data reports mutable token metadata')
    riskFlags.push('METADATA_MUTABLE')
  }

  if (externalSoftFlags.includes('BIRDEYE_TRANSFER_FEE')) {
    safetyScore -= 7
    executionScore = clamp(executionScore - 5, 0, 100)
    negatives.push('Token-2022 transfer fee is enabled')
    riskFlags.push('TRANSFER_FEE_ENABLED')
  }

  if (creatorPercent !== null) {
    if (creatorPercent >= 20) {
      safetyScore -= 20
      breakdown.concentration -= 7
      negatives.push('Creator-controlled supply is very high')
      riskFlags.push('HIGH_CREATOR_CONCENTRATION')
    } else if (creatorPercent >= 10) {
      safetyScore -= 10
      breakdown.concentration -= 4
      negatives.push('Creator-controlled supply is elevated')
      riskFlags.push('ELEVATED_CREATOR_CONCENTRATION')
    }
  }

  if (insiderPercent !== null) {
    if (insiderPercent >= 20) {
      safetyScore -= 24
      breakdown.concentration -= 9
      negatives.push('External holder analysis shows very high insider concentration')
      riskFlags.push('HIGH_INSIDER_CONCENTRATION')
    } else if (insiderPercent >= 10) {
      safetyScore -= 12
      breakdown.concentration -= 5
      negatives.push('External holder analysis shows elevated insider concentration')
      riskFlags.push('ELEVATED_INSIDER_CONCENTRATION')
    } else if (insiderPercent <= 3 && externalProviderCount > 0) {
      safetyScore += 3
    }
  }

  if (authorityConflict) {
    safetyScore -= 12
    breakdown.contract -= 5
    negatives.push('Security providers disagree on token authority state')
    riskFlags.push('SECURITY_DATA_CONFLICT')
  } else if (externalEvidence?.authority?.corroboratedSafe) {
    safetyScore += 4
    breakdown.contract += 2
    positives.push('Mint and freeze authority state is corroborated by multiple sources')
  }

  if (jupiterOrganicScore !== null && tx24 >= 100) {
    if (jupiterOrganicScore < 15) {
      setupScore = clamp(setupScore - 6, 0, 100)
      executionScore = clamp(executionScore - 4, 0, 100)
      negatives.push('Jupiter organic activity score is very low relative to observed trading')
      riskFlags.push('LOW_ORGANIC_ACTIVITY')
    } else if (jupiterOrganicScore >= 70) {
      positives.push('Jupiter reports strong organic activity')
    }
  }

  if (marketPriceConflict) {
    negatives.push('Independent market sources disagree materially on current price')
    riskFlags.push('PRICE_SOURCE_CONFLICT')
  } else if (marketPriceAgreement) {
    positives.push('Price is corroborated across multiple independent market sources')
  }

  if (marketLiquidityConflict) {
    executionScore = clamp(executionScore - 8, 0, 100)
    negatives.push('Market sources disagree materially on available liquidity')
    riskFlags.push('LIQUIDITY_SOURCE_CONFLICT')
  }

  if (marketCapConflict) {
    executionScore = clamp(executionScore - 4, 0, 100)
    negatives.push('Market sources disagree materially on circulating market cap')
    riskFlags.push('MARKET_CAP_SOURCE_CONFLICT')
  }

  const accountTop1 = finite(mintSecurity?.top1Percent) ? Number(mintSecurity.top1Percent) : null
  const accountTop5 = finite(mintSecurity?.top5Percent) ? Number(mintSecurity.top5Percent) : null
  const accountTop10 = finite(mintSecurity?.top10Percent) ? Number(mintSecurity.top10Percent) : null
  const ownerTop1 = finite(mintSecurity?.top1OwnerPercent) ? Number(mintSecurity.top1OwnerPercent) : null
  const ownerTop5 = finite(mintSecurity?.top5OwnerPercent) ? Number(mintSecurity.top5OwnerPercent) : null
  const ownerTop10 = finite(mintSecurity?.top10OwnerPercent) ? Number(mintSecurity.top10OwnerPercent) : null
  const ownerConcentrationAvailable = Boolean(mintSecurity?.ownerConcentrationAvailable)
  const accountConcentrationAvailable = Boolean(mintSecurity?.concentrationAvailable)
  const externalConcentrationAvailable = Boolean(mintSecurity?.externalConcentrationAvailable)
  const concentrationAvailable = ownerConcentrationAvailable || externalConcentrationAvailable || accountConcentrationAvailable
  // Resolved owners are strongest. External holder analysis is preferred over raw
  // token accounts because raw accounts can be LP/bonding-curve/program vaults.
  const concentrationMethod = ownerConcentrationAvailable ? 'RESOLVED_TOKEN_ACCOUNT_OWNERS' :
    externalConcentrationAvailable ? (mintSecurity?.externalConcentrationSource || 'EXTERNAL_TOP_HOLDERS') :
    accountConcentrationAvailable ? 'TOKEN_ACCOUNTS' : 'UNAVAILABLE'
  const externalTop1 = finite(mintSecurity?.externalTop1Percent) ? Number(mintSecurity.externalTop1Percent) : null
  const externalTop5 = finite(mintSecurity?.externalTop5Percent) ? Number(mintSecurity.externalTop5Percent) : null
  const externalTop10 = finite(mintSecurity?.externalTop10Percent) ? Number(mintSecurity.externalTop10Percent) : null
  const usingExternalConcentration = !ownerConcentrationAvailable && externalConcentrationAvailable
  const usingRawAccountConcentration = !ownerConcentrationAvailable && !externalConcentrationAvailable && accountConcentrationAvailable
  const top1 = ownerConcentrationAvailable ? ownerTop1 : usingExternalConcentration ? externalTop1 : accountTop1
  const top5 = ownerConcentrationAvailable ? ownerTop5 : usingExternalConcentration ? externalTop5 : accountTop5
  const top10 = ownerConcentrationAvailable ? ownerTop10 : usingExternalConcentration ? externalTop10 : accountTop10

  if (concentrationAvailable) {
    if (usingRawAccountConcentration) {
      // Raw token accounts are lower-confidence evidence: vaults and program-owned
      // accounts can look like whales. Penalize concentration, but never reward
      // apparent distribution or hard-veto a setup from raw account data alone.
      if (top1 !== null && top1 >= 70) {
        safetyScore -= 14
        breakdown.concentration -= 6
        negatives.push('Raw token-account concentration is extreme but owner identity is unresolved')
        riskFlags.push('RAW_ACCOUNT_CONCENTRATION_UNVERIFIED')
      } else if (top1 !== null && top1 >= 45) {
        safetyScore -= 8
        breakdown.concentration -= 3
        negatives.push('Raw token-account concentration is elevated but owner identity is unresolved')
        riskFlags.push('RAW_ACCOUNT_CONCENTRATION_UNVERIFIED')
      }
      if (top10 !== null && top10 >= 92) {
        safetyScore -= 6
        breakdown.concentration -= 2
      }
    } else {
      const sourceLabel = ownerConcentrationAvailable ? 'resolved owner' : 'external holder'
      const extremeFlag = ownerConcentrationAvailable ? 'EXTREME_OWNER_CONCENTRATION' : 'EXTREME_EXTERNAL_CONCENTRATION'
      const highFlag = ownerConcentrationAvailable ? 'HIGH_OWNER_CONCENTRATION' : 'HIGH_EXTERNAL_CONCENTRATION'
      const top10Flag = ownerConcentrationAvailable ? 'TOP10_OWNER_CONCENTRATION' : 'TOP10_EXTERNAL_CONCENTRATION'

      if (top1 !== null && top1 >= 70) {
        safetyScore -= 30
        breakdown.concentration -= 12
        negatives.push(`Largest ${sourceLabel} controls an extreme share of supply`)
        riskFlags.push(extremeFlag)
      } else if (top1 !== null && top1 >= 45) {
        safetyScore -= 16
        breakdown.concentration -= 6
        negatives.push(`${sourceLabel[0].toUpperCase()+sourceLabel.slice(1)} concentration is elevated`)
        riskFlags.push(highFlag)
      } else if (top1 !== null && top1 <= 20) {
        safetyScore += 5
        breakdown.concentration += 2
      }

      if (top10 !== null && top10 >= 92) {
        safetyScore -= 12
        breakdown.concentration -= 5
        negatives.push(`Top ${sourceLabel}s control most of the supply`)
        riskFlags.push(top10Flag)
      } else if (top10 !== null && top10 <= 65) {
        safetyScore += 5
        breakdown.concentration += 2
        positives.push(`${sourceLabel[0].toUpperCase()+sourceLabel.slice(1)} concentration is comparatively distributed`)
      }
    }
  }
  safetyScore = clamp(Math.round(safetyScore), 0, 100)

  const nativeStructuralDanger =
    permanentDelegateActive ||
    defaultAccountFrozen ||
    nonTransferable ||
    tokenPaused ||
    (evmSecurity && mintSecurity?.available && mintSecurity?.contractCodePresent === false)
  const evmFullReviewReady =
    Boolean(goPlusEvidence?.available) &&
    evmOpenSource === true &&
    !providerStructuralDanger &&
    !evmProxy &&
    !evmMintable &&
    !evmTakeBackOwnership &&
    !evmTransferPausable &&
    !evmBlacklistCapability &&
    !evmCannotSellAll &&
    !evmSlippageModifiable &&
    !evmPersonalSlippageModifiable

  const contractVerified = evmSecurity
    ? Boolean(
        mintSecurity?.available &&
        mintSecurity?.contractCodePresent === true &&
        evmFullReviewReady
      )
    : Boolean(
        mintSecurity?.available &&
        !mintSecurity?.mintAuthority &&
        !mintSecurity?.freezeAuthority &&
        !authorityConflict &&
        !nativeStructuralDanger &&
        !externalStructuralDanger
      )

  let dataQualityScore = 35
  if (reportedMarketCap > 0) dataQualityScore += 6
  else if (fdv > 0) dataQualityScore += 2
  if (liquidityReported) dataQualityScore += 6
  else if (bondingCurveMarket && marketCap > 0) dataQualityScore += 2
  if (volume24 > 0 && volume1 > 0) dataQualityScore += 12
  if (tx24 >= 50) dataQualityScore += 10
  if (tx1 >= 10) dataQualityScore += 8
  if (ageHours !== null) dataQualityScore += 6
  if (mintSecurity?.available) dataQualityScore += 10
  if (concentrationAvailable) dataQualityScore += 7
  if (externalProviderCount >= 3) dataQualityScore += 10
  else if (externalProviderCount === 2) dataQualityScore += 7
  else if (externalProviderCount === 1) dataQualityScore += 4
  if (externalPriceProviderCount >= 2) dataQualityScore += 8
  else if (externalPriceProviderCount === 1) dataQualityScore += 4
  if (marketPriceAgreement) dataQualityScore += 4
  if (marketPriceConflict) dataQualityScore -= 14
  if (marketLiquidityConflict) dataQualityScore -= 10
  if (marketCapConflict) dataQualityScore -= 10
  if (securityDataConflicts.length) dataQualityScore -= Math.min(18, securityDataConflicts.length * 8)
  dataQualityScore = clamp(Math.round(dataQualityScore), 10, 100)

  const scoreBeforeCaps = Math.round(setupScore * 0.45 + executionScore * 0.30 + safetyScore * 0.25)
  let score = scoreBeforeCaps
  const scoreCaps = []
  const applyScoreCap = (reason, cap, active = true) => {
    if (!active || score <= cap) return
    scoreCaps.push({ reason, cap })
    score = Math.min(score, cap)
  }

  const contractDanger =
    riskFlags.includes('MINT_AUTHORITY_ACTIVE') ||
    riskFlags.includes('FREEZE_AUTHORITY_ACTIVE') ||
    nativeStructuralDanger ||
    ruggedExternal ||
    externalStructuralDanger
  const concentrationDanger =
    riskFlags.includes('EXTREME_OWNER_CONCENTRATION') ||
    riskFlags.includes('EXTREME_EXTERNAL_CONCENTRATION')
  const collapseDanger = change24 < -45 || change6 < -35
  const sellerDanger = (buyPct24 < 34 && tx24 >= 40) || (buyPct1 < 32 && tx1 >= 15)
  const shortTermWeakness = change1 < -10 || change6 < -18
  const newborn = ageHours !== null && ageHours < 0.25

  applyScoreCap('LOW_SAFETY', 39, safetyScore < 35)
  applyScoreCap('LOW_EXECUTION', 42, executionScore < 35)
  applyScoreCap('WEAK_SETUP', 46, setupScore < 35)
  applyScoreCap('CONTRACT_DANGER', 34, contractDanger)
  applyScoreCap('NON_TRANSFERABLE_TOKEN', 8, nonTransferable)
  applyScoreCap('TOKEN_PAUSED', 10, tokenPaused)
  applyScoreCap('DEFAULT_ACCOUNT_FROZEN', 20, defaultAccountFrozen)
  applyScoreCap('PERMANENT_DELEGATE_ACTIVE', 30, permanentDelegateActive)
  applyScoreCap('TRANSFER_HOOK_ACTIVE', 60, transferHookActive)
  applyScoreCap('EVM_NO_CONTRACT_CODE', 20, riskFlags.includes('EVM_NO_CONTRACT_CODE'))
  applyScoreCap('EVM_EXTREME_TAX', 35, riskFlags.includes('EVM_EXTREME_TAX'))
  applyScoreCap('EXTERNAL_RUGGED', 12, ruggedExternal)
  applyScoreCap('EXTERNAL_STRUCTURAL_DANGER', 28, externalStructuralDanger && !ruggedExternal)
  applyScoreCap('SECURITY_DATA_CONFLICT', 55, authorityConflict)
  applyScoreCap('PRICE_SOURCE_CONFLICT', 68, marketPriceConflict)
  applyScoreCap('LIQUIDITY_SOURCE_CONFLICT', 72, marketLiquidityConflict)
  applyScoreCap('MARKET_CAP_SOURCE_CONFLICT', 74, marketCapConflict)
  applyScoreCap('JUPITER_SUSPICIOUS', 52, jupiterSuspicious)
  applyScoreCap('CONCENTRATION_DANGER', 38, concentrationDanger)
  applyScoreCap('COLLAPSE_RISK', 45, collapseDanger)
  applyScoreCap('SELLER_DOMINANCE', 48, sellerDanger)
  applyScoreCap('PARABOLIC_CHASE_RISK', 64, parabolic)
  applyScoreCap('SHORT_TERM_WEAKNESS', 62, shortTermWeakness)
  applyScoreCap('VERY_NEW_PAIR', 54, newborn)
  applyScoreCap('SECURITY_NOT_CORROBORATED', 74, externalProviderCount < 2)
  applyScoreCap('PRICE_NOT_CORROBORATED', 74, n(marketEvidence?.priceProviderCount) < 2)
  applyScoreCap('CONTRACT_NOT_VERIFIED', 80, !contractVerified)
  score = clamp(Math.round(score), 0, 100)

  let confidence = clamp(
    Math.round(dataQualityScore * 0.72 + Math.min(28, Math.log10(Math.max(1, tx24)) * 7)),
    10, 96
  )
  if (!mintSecurity?.available) confidence = Math.min(confidence, 72)
  if (!concentrationAvailable) confidence = Math.min(confidence, 86)
  if (!liquidityReported) confidence = Math.min(confidence, bondingCurveMarket ? 88 : 82)
  if (authorityConflict) confidence = Math.min(confidence, 58)
  if (securityDataConflicts.length >= 2) confidence = Math.min(confidence, 52)
  if (marketPriceConflict) confidence = Math.min(confidence, 55)
  if (marketLiquidityConflict) confidence = Math.min(confidence, 68)
  if (marketCapConflict) confidence = Math.min(confidence, 70)
  if (marketPriceAgreement && externalPriceProviderCount >= 2) confidence = Math.min(98, confidence + 3)

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
      (volumeAcceleration !== null && volumeAcceleration >= 1.25)
    )

  const leanBuyMissing = [
    score < 69 ? 'Risk-adjusted score below 69' : null,
    !priceReported ? 'Current DEX price is unavailable' : null,
    !flow1Reported || tx1 < 10 ? '1h transaction flow is insufficient or unavailable' : null,
    !flow24Reported || tx24 < 50 ? '24h transaction flow is insufficient or unavailable' : null,
    !volume1Reported || !volume24Reported ? '1h/24h volume data is incomplete' : null,
    !change1Reported ? '1h momentum data is unavailable' : null,
    !change6Reported ? '6h momentum data is unavailable' : null,
    !change24Reported ? '24h momentum data is unavailable' : null,
    ageHours === null ? 'Pair age is unavailable' : null,
    !contractVerified ? 'Contract checks are not fully verified' : null,
    externalProviderCount < 2 ? 'Security evidence is not corroborated by 2 sources' : null,
    n(marketEvidence?.priceProviderCount) < 2 ? 'Live price is not corroborated by 2 sources' : null,
    confidence < 50 ? 'Model confidence below 50' : null,
    marketLiquidityConflict ? 'Liquidity sources disagree materially' : null,
    setupScore < 64 ? 'Setup score below 64' : null,
    executionScore < 52 ? 'Execution score below 52' : null,
    safetyScore < 52 ? 'Safety score below 52' : null,
    change1 < -5 ? '1h momentum below -5%' : null,
    change6 < -8 ? '6h momentum below -8%' : null,
    change24 < -18 ? '24h momentum below -18%' : null,
    change24 > 150 ? '24h move above +150% (chase risk)' : null,
    buyPct1 < 46 ? '1h buy pressure below 46%' : null,
    buyPct1 > 80 ? '1h buy pressure above 80% (one-sided)' : null,
    parabolic ? 'Parabolic move is too extended' : null,
    newborn ? 'Pair is under 15 minutes old' : null,
  ].filter(Boolean)

  const buySetupMissing = [
    ...leanBuyMissing,
    score < 80 ? 'Risk-adjusted score below 80' : null,
    setupScore < 76 ? 'Setup score below 76' : null,
    executionScore < 65 ? 'Execution score below 65' : null,
    safetyScore < 70 ? 'Safety score below 70' : null,
    confidence < 65 ? 'Model confidence below 65' : null,
  ].filter(Boolean)

  const entryStructure = leanBuyMissing.length === 0
  let signal = 'WATCH'
  if (contractDanger || concentrationDanger || safetyScore < 25) {
    signal = 'SELL / AVOID'
  } else if (collapseDanger || sellerDanger || setupScore < 32) {
    signal = 'REDUCE'
  } else if (buySetupMissing.length === 0) {
    signal = 'BUY SETUP'
  } else if (score >= 69 && setupScore >= 64 && executionScore >= 52 && entryStructure) {
    signal = 'LEAN BUY'
  }

  if (signal === 'SELL / AVOID') score = Math.min(score, 37)
  else if (signal === 'REDUCE') score = Math.min(score, 49)
  else if (signal === 'WATCH') score = Math.min(score, 74)
  else if (signal === 'LEAN BUY') score = clamp(score, 69, 84)

  const hardRiskCount = [
    contractDanger,
    concentrationDanger,
    safetyScore < 25,
    executionScore < 20,
    collapseDanger && sellerDanger,
  ].filter(Boolean).length

  let risk = 'MODERATE'
  if (safetyScore >= 78 && executionScore >= 65 && !contractDanger && !concentrationDanger && !parabolic && !sellerDanger) {
    risk = 'LOWER'
  }
  if (
    score < 60 ||
    safetyScore < 55 ||
    executionScore < 45 ||
    parabolic ||
    shortTermWeakness ||
    sellerDanger ||
    riskFlags.includes('HIGH_OWNER_CONCENTRATION') ||
    riskFlags.includes('HIGH_ACCOUNT_CONCENTRATION')
  ) risk = 'HIGH'
  if (
    hardRiskCount > 0 ||
    score < 34 ||
    safetyScore < 30 ||
    executionScore < 18 ||
    contractDanger ||
    concentrationDanger
  ) risk = 'EXTREME'

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
  const scenarioInputsComplete =
    change1Reported &&
    change6Reported &&
    ageHours !== null

  if (reportedMarketCap > 0 && !marketCapConflict && scenarioInputsComplete) {
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

    const mc = (percent) => Math.max(0, Math.round(reportedMarketCap * (1 + percent / 100)))

    marketCapPlan = {
      available:true,
      basis:'recent-volatility-and-risk-scenario',
      current:Math.round(reportedMarketCap),
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
  } else if (reportedMarketCap > 0 && !scenarioInputsComplete) {
    marketCapPlan = {
      available:false,
      basis:'insufficient-market-history',
      current:Math.round(reportedMarketCap),
      note:'Recent momentum or pair-age history is incomplete, so RCXT suppresses market-cap scenario zones.',
    }
  } else if (marketCapConflict && reportedMarketCap > 0) {
    marketCapPlan = {
      available:false,
      basis:'market-cap-source-conflict',
      current:Math.round(reportedMarketCap),
      note:'Market-cap providers disagree materially, so RCXT suppresses market-cap target zones until valuation data converges.',
    }
  } else if (fdv > 0) {
    marketCapPlan = {
      available:false,
      basis:'fdv-only',
      current:null,
      fdv:Math.round(fdv),
      note:'Only FDV is available. RCXT will not label FDV-based projections as market-cap targets.',
    }
  }

  return {
    modelVersion: SCORE_VERSION,
    score,
    scoreBeforeCaps,
    scoreCaps,
    setupScore,
    executionScore,
    safetyScore,
    dataQualityScore,
    opportunityScore: setupScore,
    opportunityLabel,
    directionalBias,
    hotMomentum,
    marketCapPlan,
    entryGate: {
      leanBuyEligible: signal === 'LEAN BUY' || signal === 'BUY SETUP',
      buySetupEligible: signal === 'BUY SETUP',
      leanBuyMissing,
      buySetupMissing,
      entryStructure,
    },
    grade: score >= 86 ? 'A' : score >= 76 ? 'B' : score >= 64 ? 'C' : score >= 50 ? 'D' : 'F',
    signal, confidence, risk, marketState,
    buyPercent24h: round(buyPct24), buyPercent1h: round(buyPct1), buyPercent5m: round(buyPct5),
    liquidityToCapPercent: liquidityReported ? round(liquidityRatio * 100, 2) : null,
    valuationBasis,
    liquidityReported,
    liquiditySource: liquidityReported ? 'DEXSCREENER_AMM' : bondingCurveMarket ? 'PUMPFUN_BONDING_CURVE_UNREPORTED' : 'UNAVAILABLE',
    turnover24h: liquidityReported ? round(turnover24, 2) : null,
    volumeAcceleration: volumeAcceleration === null ? null : round(volumeAcceleration, 2),
    microAcceleration: microAcceleration === null ? null : round(microAcceleration, 2),
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
      externalTop1Percent:externalTop1,
      externalTop5Percent:externalTop5,
      externalTop10Percent:externalTop10,
      uniqueResolvedOwners:Number(mintSecurity?.uniqueResolvedOwners || 0),
      ownerResolutionCoveragePercent:finite(mintSecurity?.ownerResolutionCoveragePercent) ? Number(mintSecurity.ownerResolutionCoveragePercent) : null,
      ownerResolutionComplete:Boolean(mintSecurity?.ownerResolutionComplete),
    },
    securityEvidence: {
      providerCount:externalProviderCount,
      evidenceScore:finite(externalEvidence?.evidenceScore) ? Number(externalEvidence.evidenceScore) : null,
      conflicts:securityDataConflicts,
      rugged:ruggedExternal,
      dangerRiskCount:externalDangerRiskCount,
      warningRiskCount:externalWarningRiskCount,
      insiderPercent,
      creatorPercent,
      jupiterOrganicScore,
      jupiterVerified:Boolean(externalEvidence?.jupiterVerified),
      jupiterSuspicious,
      authorityCorroborated:Boolean(externalEvidence?.authority?.corroboratedSafe),
      securityModel:evmSecurity ? 'evm-token' : 'solana-mint',
      evm:evmSecurity ? {
        contractCodePresent:mintSecurity?.contractCodePresent ?? null,
        openSource:evmOpenSource,
        proxy:evmProxy,
        buyTaxPercent:evmBuyTaxPercent,
        sellTaxPercent:evmSellTaxPercent,
        honeypot:goPlusEvidence?.honeypot === true,
        cannotSell:goPlusEvidence?.cannotSellAll === true,
        malicious:goPlusEvidence?.malicious === true,
        hiddenOwner:goPlusEvidence?.hiddenOwner === true,
        ownerChangeBalance:goPlusEvidence?.ownerChangeBalance === true,
        transferPausable:evmTransferPausable,
        blacklistCapability:evmBlacklistCapability,
        mintable:evmMintable,
        ownershipReclaimable:evmTakeBackOwnership,
        cannotBuy:goPlusEvidence?.cannotBuy === true,
        cannotSellAll:evmCannotSellAll,
        tradingCooldown:evmTradingCooldown,
        modifiableTax:evmSlippageModifiable,
        personalTaxControl:evmPersonalSlippageModifiable,
        antiWhale:evmAntiWhale,
        antiWhaleModifiable:evmAntiWhaleModifiable,
        gasAbuse:goPlusEvidence?.gasAbuse === true,
        externalCall:evmExternalCall,
        ownerPercent:evmOwnerPercent,
      } : null,
      token2022:{
        detected:token2022,
        transferFeeEnabled,
        transferFeeBasisPoints,
        permanentDelegateActive,
        transferHookActive,
        defaultAccountFrozen,
        nonTransferable,
        pauseAuthorityActive,
        paused:tokenPaused,
        mintCloseAuthorityActive,
      },
      market:{
        evidenceScore:finite(marketEvidence?.evidenceScore) ? Number(marketEvidence.evidenceScore) : null,
        priceProviderCount:n(marketEvidence?.priceProviderCount),
        externalPriceProviderCount,
        medianPriceUsd:finite(marketEvidence?.medianPriceUsd) ? Number(marketEvidence.medianPriceUsd) : null,
        maxDeviationPercent:finite(marketEvidence?.maxDeviationPercent) ? Number(marketEvidence.maxDeviationPercent) : null,
        priceSpreadPercent:finite(marketEvidence?.priceSpreadPercent) ? Number(marketEvidence.priceSpreadPercent) : null,
        priceAgreement:marketPriceAgreement,
        priceConflict:marketPriceConflict,
        liquidityConflict:marketLiquidityConflict,
        marketCapProviderCount:n(marketEvidence?.marketCapProviderCount),
        medianMarketCapUsd:finite(marketEvidence?.medianMarketCapUsd) ? Number(marketEvidence.medianMarketCapUsd) : null,
        marketCapSpreadPercent:finite(marketEvidence?.marketCapSpreadPercent) ? Number(marketEvidence.marketCapSpreadPercent) : null,
        marketCapConflict,
      },
    },
    scoring: { setupWeight:45, executionWeight:30, safetyWeight:25, meaning:'Risk-adjusted tradability score. Opportunity, execution, safety, and confidence are separate axes; none is a probability of profit.' },
    riskFlags:[...new Set(riskFlags)], positives:[...new Set(positives)].slice(0,8),
    negatives:[...new Set(negatives)].slice(0,8), breakdown,
  }
}
