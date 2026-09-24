import { getChain, looksLikeEvmAddress } from './chains.js'
const BASE = 'https://api.dexscreener.com'
const pairCache = new Map()
const listCache = new Map()
const responseCache = new Map()

function readCached(cache, key, freshMs, staleMs = freshMs) {
  const entry = cache.get(key)
  if (!entry) return { fresh:null, stale:null }
  const age = Date.now() - entry.time
  if (age < freshMs) return { fresh:entry.value, stale:entry.value }
  if (age < staleMs) return { fresh:null, stale:entry.value }
  cache.delete(key)
  return { fresh:null, stale:null }
}

function setCached(cache, key, value, maxSize = 250) {
  cache.set(key, { time: Date.now(), value })
  if (cache.size > maxSize) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function dexFetch(path, { freshMs = 3500, staleMs = 60_000 } = {}) {
  const cached = readCached(responseCache, path, freshMs, staleMs)
  if (cached.fresh) return cached.fresh

  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${BASE}${path}`, {
        headers: { accept: 'application/json', 'user-agent': 'RCXT-Radar/6.1' },
        signal: AbortSignal.timeout(4500),
      })

      if (response.ok) {
        const json = await response.json()
        setCached(responseCache, path, json, 300)
        return json
      }

      lastError = new Error(`DexScreener request failed (${response.status})`)
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after') || 0)
        if (attempt < 2) await wait(Math.min(1500, retryAfter > 0 ? retryAfter * 1000 : 250 * (2 ** attempt)))
        continue
      }

      if (response.status < 500) break
    } catch (error) {
      lastError = error
    }

    if (attempt < 2) await wait(180 * (2 ** attempt))
  }

  if (cached.stale) return cached.stale
  throw lastError || new Error('DexScreener request failed')
}

export function pickBestBasePair(pairs, address, chain = 'solana') {
  const config = typeof chain === 'string' ? getChain(chain) : chain
  if (!config || !Array.isArray(pairs)) return null
  const normalized = config.family === 'evm'
    ? String(address || '').toLowerCase()
    : String(address || '')

  const exact = pairs.filter((pair) => {
    const base = String(pair?.baseToken?.address || '')
    return config.family === 'evm' ? base.toLowerCase() === normalized : base === normalized
  })

  if (!exact.length) return null
  return exact.reduce((current, pair) => {
    if (!current) return pair
    const currentLiquidity = Number(current?.liquidity?.usd || 0)
    const nextLiquidity = Number(pair?.liquidity?.usd || 0)
    if (nextLiquidity !== currentLiquidity) return nextLiquidity > currentLiquidity ? pair : current

    const currentVolume = Number(current?.volume?.h24 || 0)
    const nextVolume = Number(pair?.volume?.h24 || 0)
    return nextVolume > currentVolume ? pair : current
  }, null)
}

export async function getBestPair(address, chain = 'solana', { freshMs = 3500, staleMs = 60_000 } = {}) {
  const config = typeof chain === 'string' ? getChain(chain) : chain
  if (!config) return null
  const normalized = config.family === 'evm' ? String(address || '').toLowerCase() : String(address || '')
  const cacheKey = `${config.dexscreener}:${normalized}`
  const cached = readCached(pairCache, cacheKey, freshMs, staleMs)
  if (cached.fresh) return cached.fresh

  try {
    const pairs = await dexFetch(
      `/token-pairs/v1/${encodeURIComponent(config.dexscreener)}/${encodeURIComponent(address)}`,
      { freshMs, staleMs },
    )
    if (!Array.isArray(pairs) || pairs.length === 0) return cached.stale || null

    // DexScreener's token-pairs endpoint can return pools where the requested
    // token is either side of the pair. priceUsd/txns/priceChange describe the
    // base token, so never fall back to a quote-token pair: doing so would score
    // the wrong asset under the requested contract address.
    const best = pickBestBasePair(pairs,address,config)
    if (!best) return null
    setCached(pairCache, cacheKey, best)
    return best
  } catch {
    return cached.stale || null
  }
}

export async function resolveDexChainCandidates(address) {
  if (!looksLikeEvmAddress(address)) {
    const chain=getChain('solana')
    return chain ? [{ chain, liquidityUsd:0, volume24hUsd:0, pairAddress:null }] : []
  }

  const normalized = String(address || '').toLowerCase()
  try {
    const data = await dexFetch(`/latest/dex/search?q=${encodeURIComponent(address)}`, { freshMs:5000, staleMs:60_000 })
    const pairs = Array.isArray(data?.pairs) ? data.pairs : []
    const byChain=new Map()

    for(const pair of pairs){
      const chain=getChain(pair?.chainId)
      if(!chain||chain.family!=='evm') continue
      if(String(pair?.baseToken?.address||'').toLowerCase()!==normalized) continue

      const candidate={
        chain,
        liquidityUsd:Number(pair?.liquidity?.usd||0),
        volume24hUsd:Number(pair?.volume?.h24||0),
        pairAddress:pair?.pairAddress||null,
      }
      const current=byChain.get(chain.id)
      if(
        !current ||
        candidate.liquidityUsd>current.liquidityUsd ||
        (candidate.liquidityUsd===current.liquidityUsd&&candidate.volume24hUsd>current.volume24hUsd)
      ){
        byChain.set(chain.id,candidate)
      }
    }

    return [...byChain.values()].sort((a,b)=>
      b.liquidityUsd-a.liquidityUsd || b.volume24hUsd-a.volume24hUsd
    )
  } catch {
    return []
  }
}

export function hasMeaningfulChainAmbiguity(candidates=[]) {
  if(!Array.isArray(candidates)||candidates.length<2) return false
  const [top,second]=candidates
  const topLiquidity=Math.max(0,Number(top?.liquidityUsd||0))
  const secondLiquidity=Math.max(0,Number(second?.liquidityUsd||0))
  const secondVolume=Math.max(0,Number(second?.volume24hUsd||0))

  // Refuse to guess when a second exact-address deployment has enough real
  // activity to plausibly be the token the user intended.
  return (
    secondLiquidity>=1000 ||
    secondVolume>=5000 ||
    (topLiquidity>0&&secondLiquidity>=500&&secondLiquidity/topLiquidity>=0.20)
  )
}

export async function resolveDexChain(address) {
  const candidates=await resolveDexChainCandidates(address)
  return candidates[0]?.chain || null
}

export async function getPairsForTokens(addresses) {
  const unique = [...new Set(addresses.filter(Boolean))]
  const output = new Map()
  const missing = []

  for (const address of unique) {
    const cached = readCached(pairCache, address, 7000, 90_000)
    if (cached.fresh) output.set(address, cached.fresh)
    else {
      if (cached.stale) output.set(address, cached.stale)
      missing.push(address)
    }
  }

  for (let i = 0; i < missing.length; i += 30) {
    const chunk = missing.slice(i, i + 30)
    try {
      const pairs = await dexFetch(`/tokens/v1/solana/${chunk.join(',')}`, { freshMs:7000, staleMs:90_000 })
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
  const cached = readCached(listCache, cacheKey, 7000, 120_000)
  if (cached.fresh) return cached.fresh

  try {
    const [profiles, latestBoosts, topBoosts] = await Promise.all([
      dexFetch('/token-profiles/latest/v1', { freshMs:7000, staleMs:120_000 }).catch(() => []),
      dexFetch('/token-boosts/latest/v1', { freshMs:7000, staleMs:120_000 }).catch(() => []),
      dexFetch('/token-boosts/top/v1', { freshMs:7000, staleMs:120_000 }).catch(() => []),
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
    return cached.stale || []
  }
}
