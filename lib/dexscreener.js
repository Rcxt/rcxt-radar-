const BASE = 'https://api.dexscreener.com'
const pairCache = new Map()
const listCache = new Map()

function getCached(cache, key, ttlMs) {
  const entry = cache.get(key)
  if (!entry || Date.now() - entry.time >= ttlMs) return null
  return entry.value
}

function setCached(cache, key, value) {
  cache.set(key, { time: Date.now(), value })
  if (cache.size > 250) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
}

async function dexFetch(path) {
  let lastError
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${BASE}${path}`, {
        headers: { accept: 'application/json', 'user-agent': 'RCXT-Radar/2.1' },
        signal: AbortSignal.timeout(4500),
      })
      if (response.ok) return response.json()
      lastError = new Error(`DexScreener request failed (${response.status})`)
      if (response.status < 500 && response.status !== 429) break
    } catch (error) {
      lastError = error
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 120))
  }
  throw lastError || new Error('DexScreener request failed')
}

export async function getBestPair(address) {
  const cached = getCached(pairCache, address, 3500)
  if (cached) return cached

  try {
    const pairs = await dexFetch(`/tokens/v1/solana/${address}`)
    if (!Array.isArray(pairs) || pairs.length === 0) return null
    const best = pairs.reduce((current, pair) => {
      if (!current) return pair
      return Number(pair?.liquidity?.usd || 0) > Number(current?.liquidity?.usd || 0) ? pair : current
    }, null)
    setCached(pairCache, address, best)
    return best
  } catch {
    return null
  }
}

export async function getPairsForTokens(addresses) {
  const unique = [...new Set(addresses.filter(Boolean))]
  const output = new Map()
  const missing = []

  for (const address of unique) {
    const cached = getCached(pairCache, address, 7000)
    if (cached) output.set(address, cached)
    else missing.push(address)
  }

  for (let i = 0; i < missing.length; i += 30) {
    const chunk = missing.slice(i, i + 30)
    try {
      const pairs = await dexFetch(`/tokens/v1/solana/${chunk.join(',')}`)
      if (!Array.isArray(pairs)) continue
      for (const pair of pairs) {
        const mint = pair?.baseToken?.address
        if (!mint) continue
        const current = output.get(mint)
        if (!current || Number(pair?.liquidity?.usd || 0) > Number(current?.liquidity?.usd || 0)) {
          output.set(mint, pair)
          setCached(pairCache, mint, pair)
        }
      }
    } catch {}
  }

  return output
}

export async function getRadarCandidates(limit = 18) {
  const cacheKey = `radar:${limit}`
  const cached = getCached(listCache, cacheKey, 7000)
  if (cached) return cached

  try {
    const boosts = await dexFetch('/token-boosts/top/v1')
    if (!Array.isArray(boosts)) return []

    const addresses = []
    const seen = new Set()
    for (const item of boosts) {
      if (item?.chainId !== 'solana') continue
      if (!item?.tokenAddress || seen.has(item.tokenAddress)) continue
      seen.add(item.tokenAddress)
      addresses.push(item.tokenAddress)
      if (addresses.length >= limit * 2) break
    }

    const pairs = await getPairsForTokens(addresses)
    const result = addresses.map((address) => pairs.get(address)).filter(Boolean).slice(0, limit)
    setCached(listCache, cacheKey, result)
    return result
  } catch {
    return []
  }
}
