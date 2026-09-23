const MARKET_CACHE_TTL_MS = 30 * 1000
const MARKET_PARTIAL_TTL_MS = 10 * 1000
const marketCache = new Map()

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function compactText(value, max = 140) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function percentDiff(value, anchor) {
  const a = finiteNumber(value)
  const b = finiteNumber(anchor)
  if (a === null || b === null || a <= 0 || b <= 0) return null
  return Math.abs(a - b) / b * 100
}

function median(values) {
  const rows = values
    .map(finiteNumber)
    .filter((value) => value !== null && value > 0)
    .sort((a,b) => a-b)
  if (!rows.length) return null
  const middle = Math.floor(rows.length / 2)
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2
}

function unwrapData(data) {
  return data?.data?.data ?? data?.data ?? data
}

export function normalizeGeckoTerminalToken(data) {
  const row = data?.data
  const attributes = row?.attributes || {}
  if (!row || !attributes || typeof attributes !== 'object') {
    return { available:false, source:'geckoterminal', reason:'NO_DATA' }
  }

  const volume = attributes.volume_usd && typeof attributes.volume_usd === 'object'
    ? attributes.volume_usd
    : {}
  const changes = attributes.price_change_percentage && typeof attributes.price_change_percentage === 'object'
    ? attributes.price_change_percentage
    : {}

  return {
    available:true,
    source:'geckoterminal',
    priceUsd:finiteNumber(attributes.price_usd),
    marketCapUsd:finiteNumber(attributes.market_cap_usd),
    fdvUsd:finiteNumber(attributes.fdv_usd),
    liquidityUsd:finiteNumber(attributes.total_reserve_in_usd),
    volume24hUsd:finiteNumber(volume.h24),
    priceChange24h:finiteNumber(changes.h24),
  }
}

export function normalizeJupiterPrice(data, address) {
  const row = data && typeof data === 'object' ? data[address] : null
  if (!row || typeof row !== 'object') {
    return { available:false, source:'jupiter-price', reason:'PRICE_OMITTED' }
  }

  return {
    available:true,
    source:'jupiter-price',
    priceUsd:finiteNumber(row.usdPrice),
    blockId:finiteNumber(row.blockId),
    decimals:finiteNumber(row.decimals),
    priceChange24h:finiteNumber(row.priceChange24h),
  }
}

export function normalizeHeliusAsset(data, address) {
  const row = data?.result ?? data
  if (!row || typeof row !== 'object') {
    return { available:false, source:'helius', reason:'NO_DATA' }
  }

  const tokenInfo = row.token_info && typeof row.token_info === 'object' ? row.token_info : {}
  const priceInfo = tokenInfo.price_info && typeof tokenInfo.price_info === 'object'
    ? tokenInfo.price_info
    : {}

  return {
    available:true,
    source:'helius',
    id:String(row.id || address),
    interface:String(row.interface || ''),
    priceUsd:finiteNumber(priceInfo.price_per_token ?? priceInfo.price),
    supply:finiteNumber(tokenInfo.supply),
    decimals:finiteNumber(tokenInfo.decimals),
    tokenProgram:String(tokenInfo.token_program || tokenInfo.tokenProgram || ''),
  }
}

export function normalizeBirdeyeOverview(data) {
  const row = unwrapData(data)
  if (!row || typeof row !== 'object') {
    return { available:false, source:'birdeye-market', reason:'NO_DATA' }
  }

  return {
    available:true,
    source:'birdeye-market',
    priceUsd:finiteNumber(row.price),
    liquidityUsd:finiteNumber(row.liquidity),
    marketCapUsd:finiteNumber(row.mc ?? row.marketCap ?? row.market_cap),
    fdvUsd:finiteNumber(row.fdv),
    volume24hUsd:finiteNumber(row.v24hUSD ?? row.volume24h ?? row.volume24hUSD),
    priceChange24h:finiteNumber(row.priceChange24hPercent ?? row.priceChange24h),
    uniqueWallets24h:finiteNumber(row.uniqueWallet24h ?? row.uniqueWallets24h),
    trades24h:finiteNumber(row.trade24h ?? row.trades24h),
  }
}

async function fetchJson(url, { headers = {}, timeoutMs = 3200, method = 'GET', body = undefined } = {}) {
  const response = await fetch(url, {
    method,
    headers:{ Accept:'application/json', ...headers },
    body,
    cache:'no-store',
    signal:AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function fetchGeckoTerminal(address) {
  try {
    const data = await fetchJson(
      `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${encodeURIComponent(address)}`,
      {
        headers:{
          'user-agent':'RCXT-Radar/6.0',
          Accept:'application/json;version=20230203',
        },
        timeoutMs:3400,
      },
    )
    return normalizeGeckoTerminalToken(data)
  } catch (error) {
    return {
      available:false,
      source:'geckoterminal',
      reason:compactText(error?.message || 'GeckoTerminal unavailable'),
    }
  }
}

async function fetchJupiterPrice(address) {
  const apiKey = String(process.env.JUPITER_API_KEY || '').trim()
  const keylessEnabled = String(process.env.JUPITER_KEYLESS_ENABLED || '0') === '1'
  if (!apiKey && !keylessEnabled) {
    return { available:false, source:'jupiter-price', reason:'NOT_CONFIGURED' }
  }

  try {
    const data = await fetchJson(
      `https://api.jup.ag/price/v3?ids=${encodeURIComponent(address)}`,
      {
        headers:apiKey ? { 'x-api-key':apiKey } : {},
        timeoutMs:3000,
      },
    )
    return normalizeJupiterPrice(data, address)
  } catch (error) {
    return {
      available:false,
      source:'jupiter-price',
      reason:compactText(error?.message || 'Jupiter Price unavailable'),
    }
  }
}

async function fetchHeliusAsset(address) {
  const apiKey = String(process.env.HELIUS_API_KEY || '').trim()
  if (!apiKey) return { available:false, source:'helius', reason:'NOT_CONFIGURED' }

  try {
    const data = await fetchJson(
      `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`,
      {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body:JSON.stringify({
          jsonrpc:'2.0',
          id:'rcxt-market',
          method:'getAsset',
          params:{
            id:address,
            displayOptions:{ showFungible:true },
          },
        }),
        timeoutMs:3500,
      },
    )
    return normalizeHeliusAsset(data, address)
  } catch (error) {
    return {
      available:false,
      source:'helius',
      reason:compactText(error?.message || 'Helius unavailable'),
    }
  }
}

async function fetchBirdeyeOverview(address) {
  const apiKey = String(process.env.BIRDEYE_API_KEY || '').trim()
  const enabled = String(process.env.BIRDEYE_MARKET_ENABLED || '0') === '1'
  if (!apiKey) return { available:false, source:'birdeye-market', reason:'NOT_CONFIGURED' }
  if (!enabled) return { available:false, source:'birdeye-market', reason:'DISABLED_TO_PRESERVE_CU' }

  try {
    const data = await fetchJson(
      `https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(address)}&frames=1h,24h`,
      {
        headers:{
          'X-API-KEY':apiKey,
          'x-chain':'solana',
        },
        timeoutMs:3500,
      },
    )
    return normalizeBirdeyeOverview(data)
  } catch (error) {
    return {
      available:false,
      source:'birdeye-market',
      reason:compactText(error?.message || 'Birdeye unavailable'),
    }
  }
}

export function buildMarketConsensus(pair, providers = {}) {
  const primaryPrice = finiteNumber(pair?.priceUsd)
  const rows = [
    primaryPrice ? { source:'dexscreener', priceUsd:primaryPrice, primary:true } : null,
    providers?.geckoterminal?.available && finiteNumber(providers.geckoterminal.priceUsd)
      ? { source:'geckoterminal', priceUsd:Number(providers.geckoterminal.priceUsd) }
      : null,
    providers?.jupiterPrice?.available && finiteNumber(providers.jupiterPrice.priceUsd)
      ? { source:'jupiter-price', priceUsd:Number(providers.jupiterPrice.priceUsd) }
      : null,
    providers?.birdeye?.available && finiteNumber(providers.birdeye.priceUsd)
      ? { source:'birdeye', priceUsd:Number(providers.birdeye.priceUsd) }
      : null,
  ].filter(Boolean)

  const medianPrice = median(rows.map((row) => row.priceUsd))
  const priceRows = rows.map((row) => ({
    ...row,
    deviationPercent:medianPrice === null ? null : Number(percentDiff(row.priceUsd, medianPrice)?.toFixed(2) ?? 0),
  }))
  const maxDeviationPercent = priceRows.length
    ? Math.max(...priceRows.map((row) => Number(row.deviationPercent || 0)))
    : null

  const priceProviderCount = priceRows.length
  const externalPriceProviderCount = Math.max(0, priceProviderCount - (primaryPrice ? 1 : 0))
  const priceConflict = priceProviderCount >= 2 && Number(maxDeviationPercent || 0) >= 12
  const priceAgreement = priceProviderCount >= 3 && Number(maxDeviationPercent || 0) <= 5

  const liquidityRows = [
    finiteNumber(pair?.liquidity?.usd) !== null && Number(pair?.liquidity?.usd) > 0
      ? { source:'dexscreener', liquidityUsd:Number(pair.liquidity.usd) }
      : null,
    providers?.geckoterminal?.available && finiteNumber(providers.geckoterminal.liquidityUsd)
      ? { source:'geckoterminal', liquidityUsd:Number(providers.geckoterminal.liquidityUsd) }
      : null,
    providers?.birdeye?.available && finiteNumber(providers.birdeye.liquidityUsd)
      ? { source:'birdeye', liquidityUsd:Number(providers.birdeye.liquidityUsd) }
      : null,
  ].filter(Boolean)

  let liquidityConflict = false
  if (liquidityRows.length >= 2) {
    const values = liquidityRows.map((row) => row.liquidityUsd).filter((value) => value > 0)
    if (values.length >= 2) {
      const low = Math.min(...values)
      const high = Math.max(...values)
      liquidityConflict = low > 0 && high / low >= 3
    }
  }

  let evidenceScore = 30
  evidenceScore += Math.min(45, externalPriceProviderCount * 12)
  if (priceAgreement) evidenceScore += 12
  if (priceConflict) evidenceScore -= 24
  if (liquidityRows.length >= 2 && !liquidityConflict) evidenceScore += 8
  if (liquidityConflict) evidenceScore -= 6
  evidenceScore = clamp(Math.round(evidenceScore), 0, 100)

  return {
    version:'6.0.0',
    priceProviderCount,
    externalPriceProviderCount,
    medianPriceUsd:medianPrice,
    maxDeviationPercent,
    priceAgreement,
    priceConflict,
    liquidityConflict,
    evidenceScore,
    prices:priceRows,
    auxiliaryPrices:[
      providers?.helius?.available && finiteNumber(providers.helius.priceUsd)
        ? { source:'helius', priceUsd:Number(providers.helius.priceUsd), note:'Auxiliary only; Helius fungible prices may be cached and do not trigger live price-conflict vetoes.' }
        : null,
    ].filter(Boolean),
    liquidity:liquidityRows,
    providers:{
      geckoterminal:providers?.geckoterminal || { available:false },
      jupiterPrice:providers?.jupiterPrice || { available:false },
      helius:providers?.helius || { available:false },
      birdeye:providers?.birdeye || { available:false },
    },
  }
}

export async function getMarketConsensus(address, pair = null) {
  const cached = marketCache.get(address)
  if (cached && Date.now() - cached.time < cached.ttlMs) {
    return buildMarketConsensus(pair, cached.providers)
  }

  const [geckoterminal, jupiterPrice, helius, birdeye] = await Promise.all([
    fetchGeckoTerminal(address),
    fetchJupiterPrice(address),
    fetchHeliusAsset(address),
    fetchBirdeyeOverview(address),
  ])

  const providers = { geckoterminal, jupiterPrice, helius, birdeye }
  const availableCount = Object.values(providers).filter((provider) => provider?.available).length
  marketCache.set(address, {
    time:Date.now(),
    providers,
    ttlMs:availableCount > 0 ? MARKET_CACHE_TTL_MS : MARKET_PARTIAL_TTL_MS,
  })

  return buildMarketConsensus(pair, providers)
}
