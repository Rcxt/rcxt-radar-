export const DEFAULT_NOTIFICATION_PREFS = Object.freeze({
  newBuy: true,
  rugRisk: true,
  highRiskBuy: true,
  hotMomentumBuy: false,
  signalChanges: true,
  allSignalChanges: false,
  scoreCrossing: false,
  marketCapCrossing: false,
  radarChanges: false,
  xMomentum: false,
  repeatBuyAlerts: false,
  cooldownMinutes: 20,
})

export const NOTIFICATION_PRESETS = Object.freeze({
  KEY: {
    ...DEFAULT_NOTIFICATION_PREFS,
  },
  ACTIVE: {
    ...DEFAULT_NOTIFICATION_PREFS,
    hotMomentumBuy: true,
    scoreCrossing: true,
    marketCapCrossing: true,
    xMomentum: true,
    cooldownMinutes: 10,
  },
  EVERYTHING: {
    ...DEFAULT_NOTIFICATION_PREFS,
    hotMomentumBuy: true,
    allSignalChanges: true,
    scoreCrossing: true,
    marketCapCrossing: true,
    radarChanges: true,
    xMomentum: true,
    repeatBuyAlerts: true,
    cooldownMinutes: 5,
  },
  SILENT: {
    newBuy: false,
    rugRisk: false,
    highRiskBuy: false,
    hotMomentumBuy: false,
    signalChanges: false,
    allSignalChanges: false,
    scoreCrossing: false,
    marketCapCrossing: false,
    radarChanges: false,
    xMomentum: false,
    repeatBuyAlerts: false,
    cooldownMinutes: 20,
  },
})

const BOOLEAN_KEYS = [
  'newBuy',
  'rugRisk',
  'highRiskBuy',
  'hotMomentumBuy',
  'signalChanges',
  'allSignalChanges',
  'scoreCrossing',
  'marketCapCrossing',
  'radarChanges',
  'xMomentum',
  'repeatBuyAlerts',
]

export function normalizeNotificationPrefs(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const next = { ...DEFAULT_NOTIFICATION_PREFS }

  for (const key of BOOLEAN_KEYS) {
    if (typeof source[key] === 'boolean') next[key] = source[key]
  }

  const cooldown = Number(source.cooldownMinutes)
  if (Number.isFinite(cooldown)) {
    next.cooldownMinutes = Math.max(1, Math.min(180, Math.round(cooldown)))
  }

  if (!next.signalChanges) next.allSignalChanges = false
  return next
}

export function signalRank(signal) {
  return {
    'SELL / AVOID': 0,
    REDUCE: 1,
    WATCH: 2,
    'LEAN BUY': 3,
    'BUY SETUP': 4,
  }[String(signal || '')] ?? 2
}

export function classifySignalTransition(before, after) {
  if (!before || !after || before === after) return 'none'
  const beforeRank = signalRank(before)
  const afterRank = signalRank(after)

  if (afterRank > beforeRank && ['LEAN BUY', 'BUY SETUP'].includes(after)) return 'upgrade'
  if (afterRank < beforeRank && ['REDUCE', 'SELL / AVOID'].includes(after)) return 'danger'
  return 'other'
}

export function shouldNotifySignalTransition(before, after, prefs = DEFAULT_NOTIFICATION_PREFS) {
  const normalized = normalizeNotificationPrefs(prefs)
  if (!normalized.signalChanges || !before || !after || before === after) return false
  if (normalized.allSignalChanges) return true
  const kind = classifySignalTransition(before, after)
  return kind === 'upgrade' || kind === 'danger'
}

export function notificationCategoryEnabled(category, prefs = DEFAULT_NOTIFICATION_PREFS) {
  const normalized = normalizeNotificationPrefs(prefs)
  if (!(category in normalized)) return false
  return Boolean(normalized[category])
}
