const CACHE_TTL_MS = 3 * 60 * 1000
const PARTIAL_TTL_MS = 30 * 1000
const externalCache = new Map()

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key)
}

function authorityDisabledFromAuthority(object, key) {
  if (!hasOwn(object, key)) return null
  return object[key] === null
}

function authorityDisabledFromBoolean(value) {
  return typeof value === 'boolean' ? value : null
}

function sumPercent(rows, count) {
  return rows
    .slice(0, count)
    .reduce((sum, row) => sum + (finiteNumber(row?.pct) || 0), 0)
}

function normalizeRiskLevel(value) {
  const level = String(value || '').trim().toUpperCase()
  if (level === 'WARNING') return 'WARN'
  if (level === 'CRITICAL' || level === 'ERROR') return 'DANGER'
  return level || 'UNKNOWN'
}

function compactText(value, max = 220) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function structuralRiskName(name) {
  return /rug|honeypot|scam|malicious|mint authority|freeze authority|cannot sell|transfer blocked|blacklist|permanent delegate/i.test(String(name || ''))
}

function explicitAuthorityVotes(onchain, rugcheck, jupiter) {
  const votes = {
    mint: [],
    freeze: [],
  }

  if (onchain?.available) {
    votes.mint.push({ source:'solana-rpc', disabled:onchain.mintAuthority == null })
    votes.freeze.push({ source:'solana-rpc', disabled:onchain.freezeAuthority == null })
  }

  if (rugcheck?.available) {
    if (typeof rugcheck.mintAuthorityDisabled === 'boolean') {
      votes.mint.push({ source:'rugcheck', disabled:rugcheck.mintAuthorityDisabled })
    }
    if (typeof rugcheck.freezeAuthorityDisabled === 'boolean') {
      votes.freeze.push({ source:'rugcheck', disabled:rugcheck.freezeAuthorityDisabled })
    }
  }

  if (jupiter?.available) {
    if (typeof jupiter.mintAuthorityDisabled === 'boolean') {
      votes.mint.push({ source:'jupiter', disabled:jupiter.mintAuthorityDisabled })
    }
    if (typeof jupiter.freezeAuthorityDisabled === 'boolean') {
      votes.freeze.push({ source:'jupiter', disabled:jupiter.freezeAuthorityDisabled })
    }
  }

  return votes
}

function summarizeAuthorityVotes(votes) {
  const states = [...new Set(votes.map((vote) => vote.disabled))]
  return {
    votes,
    agreement: votes.length >= 2 ? states.length === 1 : null,
    conflict: states.length > 1,
    corroboratedDisabled: votes.filter((vote) => vote.disabled === true).length >= 2 && !votes.some((vote) => vote.disabled === false),
    activeReported: votes.some((vote) => vote.disabled === false),
  }
}

export function normalizeRugcheckReport(data) {
  if (!data || typeof data !== 'object') {
    return { available:false, source:'rugcheck', reason:'NO_DATA' }
  }

  const token = data.token && typeof data.token === 'object' ? data.token : {}
  const topHolders = Array.isArray(data.topHolders) ? data.topHolders : []
  const risks = (Array.isArray(data.risks) ? data.risks : [])
    .map((risk) => ({
      name:compactText(risk?.name, 120),
      level:normalizeRiskLevel(risk?.level),
      score:finiteNumber(risk?.score),
      value:compactText(risk?.value, 100),
      description:compactText(risk?.description),
    }))
    .filter((risk) => risk.name)
    .slice(0, 20)

  const dangerRisks = risks.filter((risk) => risk.level === 'DANGER')
  const structuralRisks = dangerRisks.filter((risk) => structuralRiskName(risk.name))
  const insiderPercent = topHolders
    .filter((holder) => holder?.insider === true)
    .reduce((sum, holder) => sum + (finiteNumber(holder?.pct) || 0), 0)

  const markets = Array.isArray(data.markets) ? data.markets : []
  const lockValues = markets
    .map((market) => finiteNumber(market?.lp?.lpLockedPct))
    .filter((value) => value !== null)

  return {
    available:true,
    source:'rugcheck',
    rugged:data.rugged === true,
    rawRiskScore:finiteNumber(data.score),
    normalizedRiskScore:finiteNumber(data.score_normalised),
    mintAuthorityDisabled:authorityDisabledFromAuthority(token, 'mintAuthority'),
    freezeAuthorityDisabled:authorityDisabledFromAuthority(token, 'freezeAuthority'),
    top1Percent:topHolders.length ? finiteNumber(topHolders[0]?.pct) : null,
    top5Percent:topHolders.length ? Number(sumPercent(topHolders, 5).toFixed(2)) : null,
    top10Percent:topHolders.length ? Number(sumPercent(topHolders, 10).toFixed(2)) : null,
    insiderPercent:topHolders.length ? Number(insiderPercent.toFixed(2)) : null,
    totalMarketLiquidityUsd:finiteNumber(data.totalMarketLiquidity),
    lpLockedPercent:lockValues.length ? Math.max(...lockValues) : null,
    totalHolders:finiteNumber(data.totalHolders),
    jupiterVerified:Boolean(data?.verification?.jup_verified || data?.verification?.jup_strict),
    risks,
    dangerRiskCount:dangerRisks.length,
    warningRiskCount:risks.filter((risk) => risk.level === 'WARN').length,
    structuralRiskNames:structuralRisks.map((risk) => risk.name),
  }
}

export function normalizeJupiterToken(data, address) {
  const rows = Array.isArray(data) ? data : []
  const token = rows.find((row) => String(row?.id || row?.address || '') === address) || rows[0]
  if (!token || typeof token !== 'object') {
    return { available:false, source:'jupiter', reason:'NO_DATA' }
  }

  const audit = token.audit && typeof token.audit === 'object' ? token.audit : {}
  return {
    available:true,
    source:'jupiter',
    id:String(token.id || token.address || address),
    isVerified:Boolean(token.isVerified),
    organicScore:finiteNumber(token.organicScore),
    organicScoreLabel:compactText(token.organicScoreLabel, 40) || null,
    holderCount:finiteNumber(token.holderCount),
    liquidityUsd:finiteNumber(token.liquidity),
    marketCapUsd:finiteNumber(token.mcap ?? token.marketCap),
    mintAuthorityDisabled:authorityDisabledFromBoolean(audit.mintAuthorityDisabled),
    freezeAuthorityDisabled:authorityDisabledFromBoolean(audit.freezeAuthorityDisabled),
  }
}

async function fetchJson(url, { headers = {}, timeoutMs = 3500 } = {}) {
  const response = await fetch(url, {
    method:'GET',
    headers:{ Accept:'application/json', ...headers },
    cache:'no-store',
    signal:AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function fetchRugcheck(address) {
  const headers = {}
  if (process.env.RUGCHECK_API_KEY) headers['X-API-KEY'] = process.env.RUGCHECK_API_KEY

  try {
    const data = await fetchJson(
      `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(address)}/report`,
      { headers, timeoutMs:4200 },
    )
    return normalizeRugcheckReport(data)
  } catch (error) {
    return {
      available:false,
      source:'rugcheck',
      reason:compactText(error?.message || 'RugCheck unavailable', 120),
    }
  }
}

async function fetchJupiter(address) {
  const apiKey = String(process.env.JUPITER_API_KEY || '').trim()
  const keylessEnabled = String(process.env.JUPITER_KEYLESS_ENABLED || '0') === '1'
  if (!apiKey && !keylessEnabled) {
    return { available:false, source:'jupiter', reason:'NOT_CONFIGURED' }
  }

  const headers = apiKey ? { 'x-api-key':apiKey } : {}
  try {
    const data = await fetchJson(
      `https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(address)}`,
      { headers, timeoutMs:3200 },
    )
    return normalizeJupiterToken(data, address)
  } catch (error) {
    return {
      available:false,
      source:'jupiter',
      reason:compactText(error?.message || 'Jupiter unavailable', 120),
    }
  }
}

export async function getExternalSecurity(address) {
  const cached = externalCache.get(address)
  if (cached && Date.now() - cached.time < cached.ttlMs) return cached.value

  const [rugcheck, jupiter] = await Promise.all([
    fetchRugcheck(address),
    fetchJupiter(address),
  ])

  const value = {
    fetchedAt:new Date().toISOString(),
    rugcheck,
    jupiter,
  }

  const providerCount = [rugcheck, jupiter].filter((provider) => provider?.available).length
  externalCache.set(address, {
    time:Date.now(),
    value,
    ttlMs:providerCount > 0 ? CACHE_TTL_MS : PARTIAL_TTL_MS,
  })
  return value
}

export function mergeSecurityEvidence(onchain = {}, externalSecurity = {}) {
  const rugcheck = externalSecurity?.rugcheck || { available:false, source:'rugcheck' }
  const jupiter = externalSecurity?.jupiter || { available:false, source:'jupiter' }
  const authorityVotes = explicitAuthorityVotes(onchain, rugcheck, jupiter)
  const mintAuthorityConsensus = summarizeAuthorityVotes(authorityVotes.mint)
  const freezeAuthorityConsensus = summarizeAuthorityVotes(authorityVotes.freeze)
  const dataConflicts = []

  if (mintAuthorityConsensus.conflict) dataConflicts.push('MINT_AUTHORITY_CONFLICT')
  if (freezeAuthorityConsensus.conflict) dataConflicts.push('FREEZE_AUTHORITY_CONFLICT')

  const rugTop1 = finiteNumber(rugcheck?.top1Percent)
  const rugTop10 = finiteNumber(rugcheck?.top10Percent)
  const onchainTop1 = finiteNumber(
    onchain?.ownerConcentrationAvailable ? onchain?.top1OwnerPercent : onchain?.top1Percent
  )
  const onchainTop10 = finiteNumber(
    onchain?.ownerConcentrationAvailable ? onchain?.top10OwnerPercent : onchain?.top10Percent
  )

  if (rugcheck?.available && rugTop1 !== null && onchainTop1 !== null && Math.abs(rugTop1 - onchainTop1) >= 15) {
    dataConflicts.push('TOP1_CONCENTRATION_CONFLICT')
  }
  if (rugcheck?.available && rugTop10 !== null && onchainTop10 !== null && Math.abs(rugTop10 - onchainTop10) >= 20) {
    dataConflicts.push('TOP10_CONCENTRATION_CONFLICT')
  }

  const providerCount = [
    onchain?.available ? 'solana-rpc' : null,
    rugcheck?.available ? 'rugcheck' : null,
    jupiter?.available ? 'jupiter' : null,
  ].filter(Boolean)

  const dangerRiskCount = Number(rugcheck?.dangerRiskCount || 0)
  const rugcheckStructural = Array.isArray(rugcheck?.structuralRiskNames)
    ? rugcheck.structuralRiskNames
    : []
  const hardRiskFlags = []

  if (rugcheck?.rugged === true) hardRiskFlags.push('RUGCHECK_RUGGED')
  if (rugcheckStructural.length) hardRiskFlags.push('RUGCHECK_STRUCTURAL_DANGER')
  if (mintAuthorityConsensus.activeReported) hardRiskFlags.push('MINT_AUTHORITY_ACTIVE_EXTERNAL')
  if (freezeAuthorityConsensus.activeReported) hardRiskFlags.push('FREEZE_AUTHORITY_ACTIVE_EXTERNAL')

  const corroboratedSafeAuthorities =
    mintAuthorityConsensus.corroboratedDisabled &&
    freezeAuthorityConsensus.corroboratedDisabled

  let evidenceScore = 25
  evidenceScore += providerCount.length * 18
  if (corroboratedSafeAuthorities) evidenceScore += 10
  evidenceScore -= dataConflicts.length * 12
  if (rugcheck?.rugged === true) evidenceScore -= 30
  evidenceScore -= Math.min(20, dangerRiskCount * 5)
  evidenceScore = clamp(Math.round(evidenceScore), 0, 100)

  return {
    ...onchain,
    externalConcentrationAvailable:Boolean(
      rugcheck?.available && (rugTop1 !== null || rugTop10 !== null)
    ),
    externalTop1Percent:rugTop1,
    externalTop5Percent:finiteNumber(rugcheck?.top5Percent),
    externalTop10Percent:rugTop10,
    sources:{
      ...(onchain?.sources || {}),
      rugcheck:Boolean(rugcheck?.available),
      jupiter:Boolean(jupiter?.available),
    },
    external:{
      version:'6.0.0-beta.1',
      fetchedAt:externalSecurity?.fetchedAt || null,
      providerCount:providerCount.length,
      providers:providerCount,
      rugcheck,
      jupiter,
      authority:{
        mint:mintAuthorityConsensus,
        freeze:freezeAuthorityConsensus,
        corroboratedSafe:corroboratedSafeAuthorities,
      },
      dataConflicts:[...new Set(dataConflicts)],
      hardRiskFlags:[...new Set(hardRiskFlags)],
      dangerRiskCount,
      warningRiskCount:Number(rugcheck?.warningRiskCount || 0),
      rugged:rugcheck?.rugged === true,
      insiderPercent:finiteNumber(rugcheck?.insiderPercent),
      jupiterOrganicScore:finiteNumber(jupiter?.organicScore),
      jupiterVerified:Boolean(jupiter?.isVerified || rugcheck?.jupiterVerified),
      evidenceScore,
    },
  }
}
