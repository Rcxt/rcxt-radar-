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

export async function getRadarCandidates(limit = 24) {
  const cacheKey = `radar:${limit}:mixed-v2`
  const cached = getCached(listCache, cacheKey, 7000)
  if (cached) return cached

  try {
    const [profiles, latestBoosts, topBoosts] = await Promise.all([
      dexFetch('/token-profiles/latest/v1').catch(() => []),
      dexFetch('/token-boosts/latest/v1').catch(() => []),
      dexFetch('/token-boosts/top/v1').catch(() => []),
    ])

    const addresses = []
    const sourceMap = new Map()
    const seen = new Set()

    function add(items, source, cap = limit * 3) {
      let added = 0
      for (const item of Array.isArray(items) ? items : []) {
        if (item?.chainId !== 'solana') continue
        const address = item?.tokenAddress
        if (!address) continue

        if (!sourceMap.has(address)) sourceMap.set(address, new Set())
        sourceMap.get(address).add(source)

        if (!seen.has(address) && added < cap) {
          seen.add(address)
          addresses.push(address)
          added += 1
        }
      }
    }

    // Latest sources come first so fresh launches are not crowded out by already-trending names.
    add(profiles, 'latest-profile', limit * 4)
    add(latestBoosts, 'latest-boost', limit * 3)
    add(topBoosts, 'top-boost', limit * 3)

    const pairs = await getPairsForTokens(addresses)
    const now = Date.now()

    const candidates = addresses
      .map((address) => {
        const pair = pairs.get(address)
        if (!pair) return null

        const createdAt = Number(pair?.pairCreatedAt || 0)
        const ageHours = createdAt ? Math.max(0, (now - createdAt) / 3_600_000) : null
        const liquidity = Number(pair?.liquidity?.usd || 0)
        const volume1h = Number(pair?.volume?.h1 || 0)
        const volume5m = Number(pair?.volume?.m5 || 0)
        const tx1h = Number(pair?.txns?.h1?.buys || 0) + Number(pair?.txns?.h1?.sells || 0)

        let freshness = 0
        if (ageHours !== null) {
          if (ageHours <= 0.25) freshness = 100
          else if (ageHours <= 0.5) freshness = 95
          else if (ageHours <= 1) freshness = 90
          else if (ageHours <= 3) freshness = 78
          else if (ageHours <= 6) freshness = 66
          else if (ageHours <= 12) freshness = 52
          else if (ageHours <= 24) freshness = 38
          else if (ageHours <= 48) freshness = 20
        }

        const liquidityQuality =
          liquidity >= 50_000 ? 100 :
          liquidity >= 20_000 ? 82 :
          liquidity >= 8_000 ? 65 :
          liquidity >= 3_000 ? 45 : 15

        const activityQuality =
          tx1h >= 300 || volume1h >= 50_000 ? 100 :
          tx1h >= 100 || volume1h >= 15_000 ? 78 :
          tx1h >= 30 || volume1h >= 4_000 ? 58 :
          tx1h >= 10 || volume5m >= 500 ? 40 : 15

        // Freshness matters, but dead/illiquid launches do not get promoted just for being new.
        const discoveryScore = Math.round(
          freshness * 0.52 +
          liquidityQuality * 0.25 +
          activityQuality * 0.23
        )

        return {
          pair,
          discoveryScore,
          sourceTags: [...(sourceMap.get(address) || [])],
          ageHours,
          liquidity,
          volume1h,
        }
      })
      .filter(Boolean)

    const viable = candidates.filter((item) =>
      item.liquidity >= 2_500 ||
      item.volume1h >= 2_500
    )

    const newest = [...viable]
      .filter((item) => item.ageHours !== null && item.ageHours <= 24)
      .sort((a, b) => b.discoveryScore - a.discoveryScore)

    const established = [...viable]
      .sort((a, b) => {
        const aTop = a.sourceTags.includes('top-boost') ? 1 : 0
        const bTop = b.sourceTags.includes('top-boost') ? 1 : 0
        if (aTop !== bTop) return bTop - aTop
        return Number(b.pair?.volume?.h24 || 0) - Number(a.pair?.volume?.h24 || 0)
      })

    const selected = []
    const selectedAddresses = new Set()
    const freshTarget = Math.max(6, Math.ceil(limit * 0.5))

    for (const item of newest) {
      const address = item.pair?.baseToken?.address
      if (!address || selectedAddresses.has(address)) continue
      selected.push(item)
      selectedAddresses.add(address)
      if (selected.length >= freshTarget) break
    }

    for (const item of established) {
      const address = item.pair?.baseToken?.address
      if (!address || selectedAddresses.has(address)) continue
      selected.push(item)
      selectedAddresses.add(address)
      if (selected.length >= limit) break
    }

    const result = selected.map((item) => ({
      ...item.pair,
      rcxtDiscovery: {
        score: item.discoveryScore,
        sourceTags: item.sourceTags,
      },
    }))

    setCached(listCache, cacheKey, result)
    return result
  } catch {
    return []
  }
}
