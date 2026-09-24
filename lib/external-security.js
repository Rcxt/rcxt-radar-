const CACHE_TTL_MS = 3 * 60 * 1000
const PARTIAL_TTL_MS = 15 * 1000
const externalCache = new Map()

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function compactText(value, max = 220) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizePercent(value) {
  const parsed = finiteNumber(value)
  if (parsed === null) return null
  if (parsed >= 0 && parsed <= 1) return parsed * 100
  return parsed
}

function sumPercent(rows, count, key = 'pct') {
  return rows
    .slice(0, count)
    .reduce((sum, row) => sum + (normalizePercent(row?.[key]) || 0), 0)
}

function normalizeRiskLevel(value) {
  const level = String(value || '').trim().toUpperCase()
  if (level === 'WARNING') return 'WARN'
  if (level === 'CRITICAL' || level === 'ERROR') return 'DANGER'
  return level || 'UNKNOWN'
}

function structuralRiskName(name) {
  return /rug|honeypot|scam|malicious|mint authority|freeze authority|cannot sell|transfer blocked|blacklist|permanent delegate/i.test(String(name || ''))
}

function activeStatus(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') {
    if (hasOwn(value, 'status')) return activeStatus(value.status)
    if (hasOwn(value, 'value')) return activeStatus(value.value)
  }
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (['1','true','yes','enabled','active','2'].includes(normalized)) return true
  if (['0','false','no','disabled','inactive'].includes(normalized)) return false
  return null
}

function explicitAuthorityVotes(onchain, rugcheck, jupiter, goplus, birdeye) {
  const votes = { mint:[], freeze:[] }

  if (onchain?.available && onchain?.securityModel !== 'evm-token') {
    votes.mint.push({ source:'solana-rpc', disabled:onchain.mintAuthority == null })
    votes.freeze.push({ source:'solana-rpc', disabled:onchain.freezeAuthority == null })
  }

  for (const [source, provider] of [
    ['rugcheck', rugcheck],
    ['jupiter', jupiter],
    ['goplus', goplus],
    ['birdeye', birdeye],
  ]) {
    if (!provider?.available) continue
    if (typeof provider.mintAuthorityDisabled === 'boolean') {
      votes.mint.push({ source, disabled:provider.mintAuthorityDisabled })
    }
    if (typeof provider.freezeAuthorityDisabled === 'boolean') {
      votes.freeze.push({ source, disabled:provider.freezeAuthorityDisabled })
    }
  }

  return votes
}

function summarizeAuthorityVotes(votes) {
  const states = [...new Set(votes.map((vote) => vote.disabled))]
  return {
    votes,
    agreement:votes.length >= 2 ? states.length === 1 : null,
    conflict:states.length > 1,
    corroboratedDisabled:votes.filter((vote) => vote.disabled === true).length >= 2 && !votes.some((vote) => vote.disabled === false),
    activeReported:votes.some((vote) => vote.disabled === false),
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
    .reduce((sum, holder) => sum + (normalizePercent(holder?.pct) || 0), 0)

  const markets = Array.isArray(data.markets) ? data.markets : []
  const lockValues = markets
    .map((market) => normalizePercent(market?.lp?.lpLockedPct))
    .filter((value) => value !== null)

  return {
    available:true,
    source:'rugcheck',
    rugged:data.rugged === true,
    rawRiskScore:finiteNumber(data.score),
    normalizedRiskScore:finiteNumber(data.score_normalised),
    mintAuthorityDisabled:authorityDisabledFromAuthority(token, 'mintAuthority'),
    freezeAuthorityDisabled:authorityDisabledFromAuthority(token, 'freezeAuthority'),
    top1Percent:topHolders.length ? normalizePercent(topHolders[0]?.pct) : null,
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
    isVerified:token.isVerified === true,
    suspicious:audit.isSus === true || String(audit.isSus ?? '').toLowerCase() === 'true',
    organicScore:finiteNumber(token.organicScore),
    organicScoreLabel:compactText(token.organicScoreLabel, 40) || null,
    holderCount:finiteNumber(token.holderCount),
    liquidityUsd:finiteNumber(token.liquidity),
    marketCapUsd:finiteNumber(token.mcap ?? token.marketCap),
    mintAuthorityDisabled:authorityDisabledFromBoolean(audit.mintAuthorityDisabled),
    freezeAuthorityDisabled:authorityDisabledFromBoolean(audit.freezeAuthorityDisabled),
  }
}

export function normalizeGoPlusSolana(data, address) {
  const root = data?.result && typeof data.result === 'object' ? data.result : {}
  const token = root[address] || root[String(address).toLowerCase()] || (Object.keys(root).length === 1 ? root[Object.keys(root)[0]] : null)
  if (!token || typeof token !== 'object') {
    return { available:false, source:'goplus', reason:'NO_DATA' }
  }

  const mintable = activeStatus(token.mintable ?? token.is_mintable)
  const freezable = activeStatus(token.freezable ?? token.freezeable ?? token.freeze_authority)
  const metadataMutable = activeStatus(token.metadata_mutable ?? token.metadata_modifiable)
  const blacklist = activeStatus(token.blacklist)
  const transferPausable = activeStatus(token.transfer_pausable)
  const defaultStateRaw = token.default_account_state?.status ?? token.default_account_state
  const defaultAccountFrozen = String(defaultStateRaw ?? '').trim() === '2'
  const holders = Array.isArray(token.holders) ? token.holders : []

  return {
    available:true,
    source:'goplus',
    mintAuthorityDisabled:mintable === null ? null : !mintable,
    freezeAuthorityDisabled:freezable === null ? null : !freezable,
    mintable,
    freezable,
    metadataMutable,
    blacklistActive:blacklist,
    transferPausable,
    defaultAccountFrozen,
    trusted:activeStatus(token.trusted_token) === true,
    top1Percent:holders.length ? normalizePercent(holders[0]?.percent) : null,
    top5Percent:holders.length ? Number(sumPercent(holders, 5, 'percent').toFixed(2)) : null,
    top10Percent:holders.length ? Number(sumPercent(holders, 10, 'percent').toFixed(2)) : null,
    holderCount:finiteNumber(token.holder_count),
    creatorAddress:compactText(token.creator_address, 60) || null,
    creatorPercent:normalizePercent(token.creator_percent),
  }
}

export function normalizeGoPlusEvm(data, address) {
  const root = data?.result && typeof data.result === 'object' ? data.result : {}
  const key = String(address || '').toLowerCase()
  const token = root[address] || root[key] || (Object.keys(root).length === 1 ? root[Object.keys(root)[0]] : null)
  if (!token || typeof token !== 'object') {
    return { available:false, source:'goplus', model:'evm', reason:'NO_DATA' }
  }

  const holders = Array.isArray(token.holders) ? token.holders : []
  const openSource = activeStatus(token.is_open_source)
  const honeypot = activeStatus(token.is_honeypot)
  const cannotBuy = activeStatus(token.cannot_buy)
  const cannotSellAll = activeStatus(token.cannot_sell_all ?? token.cannot_sell)
  const malicious = activeStatus(token.malicious_address)
  const hiddenOwner = activeStatus(token.hidden_owner)
  const ownerChangeBalance = activeStatus(token.owner_change_balance)
  const takeBackOwnership = activeStatus(token.can_take_back_ownership)
  const selfDestruct = activeStatus(token.selfdestruct)
  const transferPausable = activeStatus(token.transfer_pausable)
  const blacklistActive = activeStatus(token.is_blacklisted ?? token.blacklist)
  const proxy = activeStatus(token.is_proxy)
  const mintable = activeStatus(token.is_mintable)
  const tradingCooldown = activeStatus(token.trading_cooldown)

  return {
    available:true,
    source:'goplus',
    model:'evm',
    openSource,
    honeypot,
    cannotBuy,
    cannotSellAll,
    malicious,
    hiddenOwner,
    ownerChangeBalance,
    takeBackOwnership,
    selfDestruct,
    transferPausable,
    blacklistActive,
    proxy,
    mintable,
    tradingCooldown,
    externalCall:activeStatus(token.external_call),
    gasAbuse:activeStatus(token.gas_abuse),
    buyTaxPercent:normalizePercent(token.buy_tax),
    sellTaxPercent:normalizePercent(token.sell_tax),
    transferTaxPercent:normalizePercent(token.transfer_tax),
    top1Percent:holders.length ? normalizePercent(holders[0]?.percent) : null,
    top5Percent:holders.length ? Number(sumPercent(holders, 5, 'percent').toFixed(2)) : null,
    top10Percent:holders.length ? Number(sumPercent(holders, 10, 'percent').toFixed(2)) : null,
    holderCount:finiteNumber(token.holder_count),
    creatorAddress:compactText(token.creator_address, 60) || null,
    creatorPercent:normalizePercent(token.creator_percent),
    ownerAddress:compactText(token.owner_address, 60) || null,
    ownerPercent:normalizePercent(token.owner_percent),
    lpHolderCount:finiteNumber(token.lp_holder_count),
    isInDex:activeStatus(token.is_in_dex),
  }
}

export function normalizeBirdeyeSecurity(data) {
  const row = data?.data?.data ?? data?.data ?? data
  if (!row || typeof row !== 'object') {
    return { available:false, source:'birdeye-security', reason:'NO_DATA' }
  }

  const ownerPresent = hasOwn(row, 'ownerAddress')
  const freezePresent = hasOwn(row, 'freezeAuthority')
  return {
    available:true,
    source:'birdeye-security',
    mintAuthorityDisabled:ownerPresent ? row.ownerAddress == null : null,
    freezeAuthorityDisabled:freezePresent
      ? row.freezeAuthority == null
      : typeof row.freezeable === 'boolean'
        ? !row.freezeable
        : null,
    ownerAddress:row.ownerAddress ?? null,
    freezeAuthority:row.freezeAuthority ?? null,
    freezeable:typeof row.freezeable === 'boolean' ? row.freezeable : null,
    mutableMetadata:typeof row.mutableMetadata === 'boolean' ? row.mutableMetadata : null,
    transferFeeEnabled:typeof row.transferFeeEnable === 'boolean' ? row.transferFeeEnable : null,
    token2022:typeof row.isToken2022 === 'boolean' ? row.isToken2022 : null,
    top10Percent:normalizePercent(row.top10HolderPercent),
    creatorPercent:normalizePercent(row.creatorPercentage),
    jupiterStrict:Boolean(row.jupStrictList),
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
    return { available:false, source:'rugcheck', reason:compactText(error?.message || 'RugCheck unavailable', 120) }
  }
}

async function fetchJupiter(address) {
  const apiKey = String(process.env.JUPITER_API_KEY || '').trim()
  const keylessEnabled = String(process.env.JUPITER_KEYLESS_ENABLED || '0') === '1'
  if (!apiKey && !keylessEnabled) return { available:false, source:'jupiter', reason:'NOT_CONFIGURED' }

  const headers = apiKey ? { 'x-api-key':apiKey } : {}
  try {
    const data = await fetchJson(
      `https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(address)}`,
      { headers, timeoutMs:3200 },
    )
    return normalizeJupiterToken(data, address)
  } catch (error) {
    return { available:false, source:'jupiter', reason:compactText(error?.message || 'Jupiter unavailable', 120) }
  }
}

async function fetchGoPlus(address, chain = { id:'solana', family:'solana' }) {
  if (String(process.env.GOPLUS_ENABLED || '1') === '0') {
    return { available:false, source:'goplus', reason:'DISABLED' }
  }

  const token = String(process.env.GOPLUS_ACCESS_TOKEN || '').trim()
  const headers = token ? { Authorization:`Bearer ${token}` } : {}
  try {
    const url = chain?.family === 'evm'
      ? `https://api.gopluslabs.io/api/v1/token_security/${encodeURIComponent(chain.goplus || chain.chainId)}?contract_addresses=${encodeURIComponent(address)}`
      : `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${encodeURIComponent(address)}`
    const data = await fetchJson(url,{ headers, timeoutMs:4200 })
    return chain?.family === 'evm'
      ? normalizeGoPlusEvm(data,address)
      : normalizeGoPlusSolana(data,address)
  } catch (error) {
    return { available:false, source:'goplus', model:chain?.family || null, reason:compactText(error?.message || 'GoPlus unavailable', 120) }
  }
}

async function fetchBirdeyeSecurity(address) {
  const apiKey = String(process.env.BIRDEYE_API_KEY || '').trim()
  const enabled = String(process.env.BIRDEYE_SECURITY_ENABLED || '0') === '1'
  if (!apiKey) return { available:false, source:'birdeye-security', reason:'NOT_CONFIGURED' }
  if (!enabled) return { available:false, source:'birdeye-security', reason:'DISABLED_TO_PRESERVE_CU' }

  try {
    // Birdeye Standard is rate-limited. Stagger security behind market overview
    // so explicitly enabling both does not burst two calls at once.
    await wait(1100)
    const data = await fetchJson(
      `https://public-api.birdeye.so/defi/token_security?address=${encodeURIComponent(address)}`,
      {
        headers:{
          'X-API-KEY':apiKey,
          'x-chain':'solana',
        },
        timeoutMs:3600,
      },
    )
    return normalizeBirdeyeSecurity(data)
  } catch (error) {
    return { available:false, source:'birdeye-security', reason:compactText(error?.message || 'Birdeye security unavailable', 120) }
  }
}

export async function getExternalSecurity(address, chain = { id:'solana', family:'solana' }) {
  const cacheKey=`${chain?.id || 'solana'}:${String(address || '').toLowerCase()}`
  const cached = externalCache.get(cacheKey)
  if (cached && Date.now() - cached.time < cached.ttlMs) return cached.value

  const solana = chain?.family !== 'evm'
  const [rugcheck, jupiter, goplus, birdeye] = await Promise.all([
    solana ? fetchRugcheck(address) : Promise.resolve({ available:false, source:'rugcheck', reason:'SOLANA_ONLY' }),
    solana ? fetchJupiter(address) : Promise.resolve({ available:false, source:'jupiter', reason:'SOLANA_ONLY' }),
    fetchGoPlus(address,chain),
    solana ? fetchBirdeyeSecurity(address) : Promise.resolve({ available:false, source:'birdeye-security', reason:'SOLANA_ONLY' }),
  ])

  const value = {
    fetchedAt:new Date().toISOString(),
    chain:chain?.id || 'solana',
    rugcheck,
    jupiter,
    goplus,
    birdeye,
  }

  const providerCount = [rugcheck, jupiter, goplus, birdeye].filter((provider) => provider?.available).length
  externalCache.set(cacheKey, {
    time:Date.now(),
    value,
    ttlMs:providerCount > 0 ? CACHE_TTL_MS : PARTIAL_TTL_MS,
  })
  return value
}

export function mergeSecurityEvidence(onchain = {}, externalSecurity = {}, marketEvidence = null) {
  const rugcheck = externalSecurity?.rugcheck || { available:false, source:'rugcheck' }
  const jupiter = externalSecurity?.jupiter || { available:false, source:'jupiter' }
  const goplus = externalSecurity?.goplus || { available:false, source:'goplus' }
  const birdeye = externalSecurity?.birdeye || { available:false, source:'birdeye-security' }
  const authorityVotes = explicitAuthorityVotes(onchain, rugcheck, jupiter, goplus, birdeye)
  const mintAuthorityConsensus = summarizeAuthorityVotes(authorityVotes.mint)
  const freezeAuthorityConsensus = summarizeAuthorityVotes(authorityVotes.freeze)
  const dataConflicts = []

  if (mintAuthorityConsensus.conflict) dataConflicts.push('MINT_AUTHORITY_CONFLICT')
  if (freezeAuthorityConsensus.conflict) dataConflicts.push('FREEZE_AUTHORITY_CONFLICT')

  const rugTop1 = finiteNumber(rugcheck?.top1Percent)
  const rugTop10 = finiteNumber(rugcheck?.top10Percent)
  const goTop1 = finiteNumber(goplus?.top1Percent)
  const goTop10 = finiteNumber(goplus?.top10Percent)
  const birdTop10 = finiteNumber(birdeye?.top10Percent)
  const onchainTop1 = finiteNumber(onchain?.ownerConcentrationAvailable ? onchain?.top1OwnerPercent : onchain?.top1Percent)
  const onchainTop10 = finiteNumber(onchain?.ownerConcentrationAvailable ? onchain?.top10OwnerPercent : onchain?.top10Percent)

  if (rugcheck?.available && rugTop1 !== null && onchainTop1 !== null && Math.abs(rugTop1 - onchainTop1) >= 15) {
    dataConflicts.push('TOP1_CONCENTRATION_CONFLICT')
  }
  if (rugcheck?.available && rugTop10 !== null && onchainTop10 !== null && Math.abs(rugTop10 - onchainTop10) >= 20) {
    dataConflicts.push('TOP10_CONCENTRATION_CONFLICT')
  }
  if (goplus?.available && goTop10 !== null && onchainTop10 !== null && Math.abs(goTop10 - onchainTop10) >= 20) {
    dataConflicts.push('GOPLUS_TOP10_CONCENTRATION_CONFLICT')
  }
  if (birdeye?.available && birdTop10 !== null && onchainTop10 !== null && Math.abs(birdTop10 - onchainTop10) >= 20) {
    dataConflicts.push('BIRDEYE_TOP10_CONCENTRATION_CONFLICT')
  }

  const providers = [
    onchain?.available ? (onchain?.source || (onchain?.securityModel === 'evm-token' ? 'evm-rpc' : 'solana-rpc')) : null,
    rugcheck?.available ? 'rugcheck' : null,
    jupiter?.available ? 'jupiter' : null,
    goplus?.available ? 'goplus' : null,
    birdeye?.available ? 'birdeye-security' : null,
  ].filter(Boolean)

  const dangerRiskCount =
    Number(rugcheck?.dangerRiskCount || 0) +
    (goplus?.blacklistActive ? 1 : 0) +
    (goplus?.defaultAccountFrozen ? 1 : 0) +
    (goplus?.transferPausable ? 1 : 0) +
    (goplus?.honeypot ? 1 : 0) +
    (goplus?.cannotSellAll ? 1 : 0) +
    (goplus?.malicious ? 1 : 0) +
    (goplus?.ownerChangeBalance ? 1 : 0) +
    (goplus?.hiddenOwner ? 1 : 0) +
    (goplus?.selfDestruct ? 1 : 0)

  const warningRiskCount =
    Number(rugcheck?.warningRiskCount || 0) +
    (jupiter?.suspicious ? 1 : 0) +
    (goplus?.metadataMutable ? 1 : 0) +
    (birdeye?.mutableMetadata ? 1 : 0) +
    (birdeye?.transferFeeEnabled ? 1 : 0)

  const rugcheckStructural = Array.isArray(rugcheck?.structuralRiskNames) ? rugcheck.structuralRiskNames : []
  const hardRiskFlags = []

  if (rugcheck?.rugged === true) hardRiskFlags.push('RUGCHECK_RUGGED')
  if (rugcheckStructural.length) hardRiskFlags.push('RUGCHECK_STRUCTURAL_DANGER')
  if (jupiter?.suspicious) hardRiskFlags.push('JUPITER_SUSPICIOUS')
  if (goplus?.blacklistActive) hardRiskFlags.push('GOPLUS_BLACKLIST')
  if (goplus?.defaultAccountFrozen) hardRiskFlags.push('GOPLUS_DEFAULT_FROZEN')
  if (goplus?.transferPausable) hardRiskFlags.push('GOPLUS_TRANSFER_PAUSABLE')
  if (goplus?.honeypot) hardRiskFlags.push('GOPLUS_HONEYPOT')
  if (goplus?.cannotSellAll) hardRiskFlags.push('GOPLUS_CANNOT_SELL')
  if (goplus?.malicious) hardRiskFlags.push('GOPLUS_MALICIOUS_TOKEN')
  if (goplus?.ownerChangeBalance) hardRiskFlags.push('GOPLUS_OWNER_CHANGE_BALANCE')
  if (goplus?.hiddenOwner) hardRiskFlags.push('GOPLUS_HIDDEN_OWNER')
  if (goplus?.selfDestruct) hardRiskFlags.push('GOPLUS_SELFDESTRUCT')
  if (mintAuthorityConsensus.activeReported) hardRiskFlags.push('MINT_AUTHORITY_ACTIVE_EXTERNAL')
  if (freezeAuthorityConsensus.activeReported) hardRiskFlags.push('FREEZE_AUTHORITY_ACTIVE_EXTERNAL')

  const softRiskFlags = []
  if (goplus?.metadataMutable) softRiskFlags.push('GOPLUS_METADATA_MUTABLE')
  if (goplus?.openSource === false) softRiskFlags.push('GOPLUS_CLOSED_SOURCE')
  if (goplus?.proxy) softRiskFlags.push('GOPLUS_PROXY')
  if (goplus?.takeBackOwnership) softRiskFlags.push('GOPLUS_OWNERSHIP_RECLAIMABLE')
  if (goplus?.mintable) softRiskFlags.push('GOPLUS_MINTABLE')
  if (goplus?.tradingCooldown) softRiskFlags.push('GOPLUS_TRADING_COOLDOWN')
  if (finiteNumber(goplus?.sellTaxPercent) !== null && Number(goplus.sellTaxPercent) >= 10) softRiskFlags.push('GOPLUS_HIGH_SELL_TAX')
  if (finiteNumber(goplus?.buyTaxPercent) !== null && Number(goplus.buyTaxPercent) >= 10) softRiskFlags.push('GOPLUS_HIGH_BUY_TAX')
  if (birdeye?.mutableMetadata) softRiskFlags.push('BIRDEYE_METADATA_MUTABLE')
  if (birdeye?.transferFeeEnabled) softRiskFlags.push('BIRDEYE_TRANSFER_FEE')
  if (finiteNumber(birdeye?.creatorPercent) !== null && Number(birdeye.creatorPercent) >= 10) {
    softRiskFlags.push('BIRDEYE_HIGH_CREATOR_SHARE')
  }

  const corroboratedSafeAuthorities =
    mintAuthorityConsensus.corroboratedDisabled &&
    freezeAuthorityConsensus.corroboratedDisabled

  const externalConcentrationSource =
    rugcheck?.available && (rugTop1 !== null || rugTop10 !== null) ? 'RUGCHECK_TOP_HOLDERS' :
    goplus?.available && (goTop1 !== null || goTop10 !== null) ? 'GOPLUS_TOP_HOLDERS' :
    birdeye?.available && birdTop10 !== null ? 'BIRDEYE_TOP_HOLDERS' :
    null

  const externalTop1 =
    externalConcentrationSource === 'RUGCHECK_TOP_HOLDERS' ? rugTop1 :
    externalConcentrationSource === 'GOPLUS_TOP_HOLDERS' ? goTop1 :
    null
  const externalTop5 =
    externalConcentrationSource === 'RUGCHECK_TOP_HOLDERS' ? finiteNumber(rugcheck?.top5Percent) :
    externalConcentrationSource === 'GOPLUS_TOP_HOLDERS' ? finiteNumber(goplus?.top5Percent) :
    null
  const externalTop10 =
    externalConcentrationSource === 'RUGCHECK_TOP_HOLDERS' ? rugTop10 :
    externalConcentrationSource === 'GOPLUS_TOP_HOLDERS' ? goTop10 :
    externalConcentrationSource === 'BIRDEYE_TOP_HOLDERS' ? birdTop10 :
    null

  let evidenceScore = 20
  evidenceScore += Math.min(60, providers.length * 14)
  if (corroboratedSafeAuthorities) evidenceScore += 10
  evidenceScore -= dataConflicts.length * 10
  if (rugcheck?.rugged === true) evidenceScore -= 30
  evidenceScore -= Math.min(24, dangerRiskCount * 6)
  if (jupiter?.suspicious) evidenceScore -= 10
  evidenceScore = clamp(Math.round(evidenceScore), 0, 100)

  return {
    ...onchain,
    externalConcentrationAvailable:Boolean(externalConcentrationSource),
    externalConcentrationSource,
    externalTop1Percent:externalTop1,
    externalTop5Percent:externalTop5,
    externalTop10Percent:externalTop10,
    sources:{
      ...(onchain?.sources || {}),
      rugcheck:Boolean(rugcheck?.available),
      jupiter:Boolean(jupiter?.available),
      goplus:Boolean(goplus?.available),
      birdeye:Boolean(birdeye?.available),
    },
    external:{
      version:'6.1.0-beta.1',
      fetchedAt:externalSecurity?.fetchedAt || null,
      providerCount:providers.length,
      providers,
      rugcheck,
      jupiter,
      goplus,
      birdeye,
      market:marketEvidence,
      authority:{
        mint:mintAuthorityConsensus,
        freeze:freezeAuthorityConsensus,
        corroboratedSafe:corroboratedSafeAuthorities,
      },
      dataConflicts:[...new Set(dataConflicts)],
      hardRiskFlags:[...new Set(hardRiskFlags)],
      softRiskFlags:[...new Set(softRiskFlags)],
      dangerRiskCount,
      warningRiskCount,
      rugged:rugcheck?.rugged === true,
      insiderPercent:finiteNumber(rugcheck?.insiderPercent),
      creatorPercent:finiteNumber(birdeye?.creatorPercent ?? goplus?.creatorPercent),
      jupiterOrganicScore:finiteNumber(jupiter?.organicScore),
      jupiterVerified:Boolean(jupiter?.isVerified || rugcheck?.jupiterVerified || birdeye?.jupiterStrict),
      jupiterSuspicious:Boolean(jupiter?.suspicious),
      evidenceScore,
    },
  }
}
