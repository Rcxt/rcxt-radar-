const BASE = 'https://api.dexscreener.com'

async function dexFetch(path) {
  const response = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`DexScreener request failed (${response.status})`)
  return response.json()
}

export async function getBestPair(address) {
  try {
    const pairs = await dexFetch(`/tokens/v1/solana/${address}`)
    if (!Array.isArray(pairs) || pairs.length === 0) return null
    return pairs.reduce((best, pair) => {
      if (!best) return pair
      return Number(pair?.liquidity?.usd || 0) > Number(best?.liquidity?.usd || 0) ? pair : best
    }, null)
  } catch {
    return null
  }
}

export async function getPairsForTokens(addresses) {
  const unique = [...new Set(addresses.filter(Boolean))]
  const output = new Map()
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30)
    try {
      const pairs = await dexFetch(`/tokens/v1/solana/${chunk.join(',')}`)
      if (!Array.isArray(pairs)) continue
      for (const pair of pairs) {
        const mint = pair?.baseToken?.address
        if (!mint) continue
        const current = output.get(mint)
        if (!current || Number(pair?.liquidity?.usd || 0) > Number(current?.liquidity?.usd || 0)) output.set(mint, pair)
      }
    } catch {}
  }
  return output
}

export async function getRadarCandidates(limit = 18) {
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
    return addresses.map((address) => pairs.get(address)).filter(Boolean).slice(0, limit)
  } catch {
    return []
  }
}
