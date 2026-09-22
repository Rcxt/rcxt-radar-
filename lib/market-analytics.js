const EPSILON = 1e-12

export function mean(values) {
  const nums = values.filter(Number.isFinite)
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null
}

export function standardDeviation(values) {
  const avg = mean(values)
  if (avg == null) return null
  const nums = values.filter(Number.isFinite)
  if (nums.length < 2) return 0
  return Math.sqrt(nums.reduce((sum, value) => sum + (value - avg) ** 2, 0) / nums.length)
}

export function ema(values, period) {
  const nums = values.filter(Number.isFinite)
  if (!nums.length) return null
  const alpha = 2 / (period + 1)
  let value = nums[0]
  for (let i = 1; i < nums.length; i += 1) value = alpha * nums[i] + (1 - alpha) * value
  return value
}

export function sma(values, period) {
  const nums = values.filter(Number.isFinite)
  if (!nums.length) return null
  return mean(nums.slice(-Math.min(period, nums.length)))
}

export function rsi(values, period = 14) {
  const nums = values.filter(Number.isFinite)
  if (nums.length < 2) return null
  const lookback = nums.slice(-(period + 1))
  let gains = 0
  let losses = 0
  for (let i = 1; i < lookback.length; i += 1) {
    const delta = lookback[i] - lookback[i - 1]
    if (delta >= 0) gains += delta
    else losses += Math.abs(delta)
  }
  const denom = Math.max(1, lookback.length - 1)
  const avgGain = gains / denom
  const avgLoss = losses / denom
  if (avgLoss <= EPSILON) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

export function atr(candles, period = 14) {
  if (!candles?.length) return null
  const slice = candles.slice(-(period + 1))
  const ranges = []
  for (let i = 0; i < slice.length; i += 1) {
    const candle = slice[i]
    const prevClose = i > 0 ? slice[i - 1].close : candle.open
    ranges.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - prevClose),
      Math.abs(candle.low - prevClose),
    ))
  }
  return mean(ranges)
}

function percentChange(from, to) {
  const a = Number(from || 0)
  const b = Number(to || 0)
  return a > 0 ? ((b / a) - 1) * 100 : 0
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function localLevels(candles, mode, count = 3) {
  if (!candles?.length) return []
  const recent = candles.slice(-80)
  const values = recent.map((candle) => mode === 'support' ? candle.low : candle.high).filter(Number.isFinite)
  if (!values.length) return []
  const sorted = [...values].sort((a, b) => a - b)
  const quantiles = mode === 'support' ? [0.1, 0.25, 0.4] : [0.6, 0.75, 0.9]
  return quantiles
    .map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))])
    .filter((value, index, array) => value > 0 && (index === 0 || Math.abs(value - array[index - 1]) / value > 0.005))
    .slice(0, count)
    .map((value) => round(value, 12))
}

function candleReturnSeries(candles) {
  const result = []
  for (let i = 1; i < candles.length; i += 1) {
    const previous = candles[i - 1].close
    const current = candles[i].close
    if (previous > 0 && current > 0) result.push(((current / previous) - 1) * 100)
  }
  return result
}

function volumeTrend(candles) {
  if (candles.length < 6) return 1
  const recent = candles.slice(-3).map((candle) => candle.volume)
  const prior = candles.slice(-9, -3).map((candle) => candle.volume)
  const recentAvg = mean(recent) || 0
  const priorAvg = mean(prior) || 0
  return priorAvg > 0 ? recentAvg / priorAvg : recentAvg > 0 ? 2 : 1
}

function horizonCandles(intervalMinutes, horizonMinutes) {
  return Math.max(1, horizonMinutes / Math.max(1, intervalMinutes))
}

function projectRange({ price, atrValue, intervalMinutes, horizonMinutes, bias }) {
  const bars = horizonCandles(intervalMinutes, horizonMinutes)
  const rawMove = price > 0 && atrValue ? (atrValue / price) * 100 * Math.sqrt(bars) : 0
  const range = clamp(rawMove, 1.5, horizonMinutes <= 60 ? 45 : 90)
  const directionalShift = clamp(bias / 100 * range * 0.45, -range * 0.4, range * 0.4)
  return {
    expectedMovePercent: round(range, 1),
    bearPercent: round(-range + directionalShift, 1),
    basePercent: round(directionalShift, 1),
    bullPercent: round(range + directionalShift, 1),
    bearPrice: round(price * (1 + (-range + directionalShift) / 100), 12),
    basePrice: round(price * (1 + directionalShift / 100), 12),
    bullPrice: round(price * (1 + (range + directionalShift) / 100), 12),
  }
}

export function analyzeCandles(candles, { intervalMinutes = 5 } = {}) {
  const clean = (candles || [])
    .filter((candle) => Number.isFinite(candle?.close) && candle.close > 0)
    .sort((a, b) => a.timestamp - b.timestamp)

  if (clean.length < 5) {
    return { available:false, reason:'Not enough candle history yet', sampleSize:clean.length }
  }

  const closes = clean.map((candle) => candle.close)
  const volumes = clean.map((candle) => candle.volume)
  const latest = clean.at(-1)
  const latestPrice = latest.close
  const returns = candleReturnSeries(clean)
  const ema9 = ema(closes.slice(-60), 9)
  const ema21 = ema(closes.slice(-80), 21)
  const sma20 = sma(closes, 20)
  const sma50 = sma(closes, 50)
  const rsi14 = rsi(closes, 14)
  const atr14 = atr(clean, 14)
  const volatility = standardDeviation(returns.slice(-30)) || 0
  const volumeAcceleration = volumeTrend(clean)
  const high = Math.max(...clean.slice(-60).map((candle) => candle.high))
  const low = Math.min(...clean.slice(-60).map((candle) => candle.low))

  let peak = clean[0].close
  let maxDrawdown = 0
  for (const candle of clean) {
    peak = Math.max(peak, candle.high)
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, ((candle.low / peak) - 1) * 100)
  }

  const change15m = percentChange(clean[Math.max(0, clean.length - Math.ceil(15 / intervalMinutes) - 1)]?.close, latestPrice)
  const change1h = percentChange(clean[Math.max(0, clean.length - Math.ceil(60 / intervalMinutes) - 1)]?.close, latestPrice)
  const change6h = percentChange(clean[Math.max(0, clean.length - Math.ceil(360 / intervalMinutes) - 1)]?.close, latestPrice)

  let bias = 0
  const reasons = []
  const risks = []

  if (ema9 != null && ema21 != null) {
    if (ema9 > ema21) { bias += 14; reasons.push('Fast EMA is above slow EMA') }
    else { bias -= 14; risks.push('Fast EMA is below slow EMA') }
  }
  if (sma20 != null && latestPrice > sma20) { bias += 9; reasons.push('Price is above its 20-candle average') }
  else if (sma20 != null) { bias -= 9; risks.push('Price is below its 20-candle average') }

  if (rsi14 != null) {
    if (rsi14 >= 52 && rsi14 <= 68) { bias += 8; reasons.push('RSI is constructive without being extreme') }
    if (rsi14 > 78) { bias -= 12; risks.push('RSI is extremely stretched') }
    if (rsi14 < 35) { bias -= 9; risks.push('RSI shows weak momentum') }
  }

  if (change15m > 0 && change1h > 0) { bias += 9; reasons.push('15m and 1h momentum agree') }
  if (change15m < 0 && change1h < 0) { bias -= 10; risks.push('15m and 1h momentum are both negative') }
  if (change1h < -25) { bias -= 18; risks.push('1h price structure is collapsing') }
  if (change15m > 25) { bias -= 8; risks.push('Short-term move is extended') }

  if (volumeAcceleration >= 1.25) { bias += 8; reasons.push('Recent candle volume is accelerating') }
  if (volumeAcceleration <= 0.55) { bias -= 6; risks.push('Recent volume is fading') }

  const atrPercent = latestPrice > 0 && atr14 ? atr14 / latestPrice * 100 : 0
  if (atrPercent > 18) risks.push('Candle volatility is extremely high')
  if (volatility > 16) risks.push('Return volatility is unstable')

  bias = clamp(Math.round(bias), -100, 100)

  const trend = bias >= 25 ? 'BULLISH' : bias <= -25 ? 'BEARISH' : 'MIXED'

  const support = localLevels(clean,'support')
  const resistance = localLevels(clean,'resistance')
  const nearestSupport = [...support].filter((value)=>value<latestPrice).sort((a,b)=>b-a)[0] ?? support.at(-1) ?? null
  const nearestResistance = [...resistance].filter((value)=>value>latestPrice).sort((a,b)=>a-b)[0] ?? resistance[0] ?? null
  const downsideToSupportPercent = nearestSupport && latestPrice>0 ? ((nearestSupport/latestPrice)-1)*100 : null
  const upsideToResistancePercent = nearestResistance && latestPrice>0 ? ((nearestResistance/latestPrice)-1)*100 : null
  const structureRiskReward =
    upsideToResistancePercent != null &&
    downsideToSupportPercent != null &&
    downsideToSupportPercent < 0
      ? Math.max(0, upsideToResistancePercent / Math.abs(downsideToSupportPercent))
      : null

  const volatilityLabel =
    atrPercent >= 18 || volatility >= 16 ? 'EXTREME' :
    atrPercent >= 10 || volatility >= 10 ? 'HIGH' :
    atrPercent >= 5 || volatility >= 5 ? 'MODERATE' : 'LOW'

  const structure =
    ema9 != null && ema21 != null && latestPrice > ema9 && ema9 > ema21 ? 'UPTREND' :
    ema9 != null && ema21 != null && latestPrice < ema9 && ema9 < ema21 ? 'DOWNTREND' :
    Math.abs(change1h) < 8 ? 'RANGE' : 'TRANSITION'

  const phase =
    volumeAcceleration >= 1.4 && Math.abs(change1h) >= 8 ? 'EXPANSION' :
    volumeAcceleration <= 0.65 ? 'COOLING' :
    structure === 'RANGE' ? 'CONSOLIDATION' : 'NORMAL'

  const dataQuality = clamp(Math.round(
    Math.min(55, clean.length / 2) +
    (clean.length >= 50 ? 15 : 0) +
    (volumes.filter((value) => value > 0).length / clean.length) * 20 +
    (atr14 != null ? 10 : 0)
  ), 0, 100)

  const modelConfidence = clamp(Math.round(
    dataQuality * 0.55 +
    Math.min(35, Math.abs(bias) * 0.45) +
    (Math.sign(change15m) === Math.sign(change1h) ? 10 : 0)
  ), 15, 92)

  return {
    available:true,
    sampleSize:clean.length,
    intervalMinutes,
    latestPrice:round(latestPrice,12),
    trend,
    bias,
    modelConfidence,
    dataQuality,
    indicators:{
      ema9:round(ema9,12),
      ema21:round(ema21,12),
      sma20:round(sma20,12),
      sma50:round(sma50,12),
      rsi14:round(rsi14,1),
      atr14:round(atr14,12),
      atrPercent:round(atrPercent,1),
      realizedVolatility:round(volatility,1),
      volumeAcceleration:round(volumeAcceleration,2),
      rangeHigh:round(high,12),
      rangeLow:round(low,12),
      maxDrawdown:round(maxDrawdown,1),
    },
    momentum:{m15:round(change15m,1),h1:round(change1h,1),h6:round(change6h,1)},
    levels:{
      support,
      resistance,
      nearestSupport:round(nearestSupport,12),
      nearestResistance:round(nearestResistance,12),
      downsideToSupportPercent:round(downsideToSupportPercent,1),
      upsideToResistancePercent:round(upsideToResistancePercent,1),
      structureRiskReward:round(structureRiskReward,2),
    },
    regime:{
      structure,
      volatility:volatilityLabel,
      phase,
    },
    forecast:{
      m15:projectRange({price:latestPrice,atrValue:atr14,intervalMinutes,horizonMinutes:15,bias}),
      h1:projectRange({price:latestPrice,atrValue:atr14,intervalMinutes,horizonMinutes:60,bias}),
      h6:projectRange({price:latestPrice,atrValue:atr14,intervalMinutes,horizonMinutes:360,bias}),
    },
    reasons:reasons.slice(0,5),
    risks:risks.slice(0,5),
    disclaimer:'Scenario ranges are volatility-based estimates, not guaranteed prices or probabilities of profit.',
  }
}
