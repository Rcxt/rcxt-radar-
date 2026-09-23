const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const SECURITY_TTL_MS = 5 * 60 * 1000
const PARTIAL_SECURITY_TTL_MS = 15 * 1000
const securityCache = new Map()

function rpcEndpoints() {
  const configured = [
    ...(process.env.SOLANA_RPC_URLS || '').split(','),
    process.env.SOLANA_RPC_URL || '',
    process.env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY)}`
      : '',
    DEFAULT_RPC,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  return [...new Set(configured)]
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function looksLikeSolanaAddress(value) {
  return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim())
}

export async function rpc(method, params) {
  const endpoints = rpcEndpoints()
  let lastError

  for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex++) {
    const endpoint = endpoints[endpointIndex]

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'rcxt-radar', method, params }),
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        })

        if (response.ok) {
          const data = await response.json()
          if (data.error) throw new Error(data.error.message || 'Solana RPC error')
          return data.result
        }

        lastError = new Error(`Solana RPC HTTP ${response.status}`)
        const retryable = response.status === 429 || response.status >= 500
        if (!retryable) break
      } catch (error) {
        lastError = error
      }

      if (attempt === 0) await wait(180)
    }

    if (endpointIndex < endpoints.length - 1) await wait(120)
  }

  throw lastError || new Error('All configured Solana RPC endpoints failed')
}

function percentageFromRaw(rawAmount, rawSupply) {
  try {
    const amount = BigInt(rawAmount || '0')
    const supply = BigInt(rawSupply || '0')
    if (supply <= 0n) return null
    return Number((amount * 10000n) / supply) / 100
  } catch {
    return null
  }
}

export async function getMintSecurity(address) {
  const cached = securityCache.get(address)
  if (cached && Date.now() - cached.time < Number(cached.ttlMs || SECURITY_TTL_MS)) return cached.value

  // Stagger the heavier holder lookup so public RPCs are less likely to throttle
  // three simultaneous requests from a fresh token scan.
  const [accountResult, supplyResult, largestResult] = await Promise.allSettled([
    rpc('getAccountInfo', [address, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
    rpc('getTokenSupply', [address, { commitment: 'confirmed' }]),
    (async () => {
      await wait(160)
      return rpc('getTokenLargestAccounts', [address, { commitment: 'confirmed' }])
    })(),
  ])

  const account = accountResult.status === 'fulfilled' ? accountResult.value : null
  const largest = largestResult.status === 'fulfilled' ? largestResult.value : null
  const supply = supplyResult.status === 'fulfilled' ? supplyResult.value : null

  const info = account?.value?.data?.parsed?.info
  const rawSupply = supply?.value?.amount || info?.supply || '0'
  const largestAccounts = Array.isArray(largest?.value) ? largest.value : []
  const rawAmounts = largestAccounts.map((item) => item?.amount || '0')

  let largestOwnerResult = null
  if (largestAccounts.length) {
    const addresses = largestAccounts
      .slice(0, 20)
      .map((item) => item?.address)
      .filter(looksLikeSolanaAddress)

    if (addresses.length) {
      try {
        largestOwnerResult = await rpc('getMultipleAccounts', [
          addresses,
          { encoding:'jsonParsed', commitment:'confirmed' },
        ])
      } catch {}
    }
  }

  const ownerAmounts = new Map()
  const ownerRows = Array.isArray(largestOwnerResult?.value) ? largestOwnerResult.value : []
  ownerRows.forEach((account, index) => {
    const owner = account?.data?.parsed?.info?.owner
    const raw = rawAmounts[index] || '0'
    if (!owner) return
    try {
      ownerAmounts.set(owner, (ownerAmounts.get(owner) || 0n) + BigInt(raw))
    } catch {}
  })

  const ownerRawRows = [...ownerAmounts.entries()]
    .map(([owner, rawAmount]) => ({ owner, rawAmount }))
    .sort((a, b) => (a.rawAmount > b.rawAmount ? -1 : a.rawAmount < b.rawAmount ? 1 : 0))
  const ownerRawAmounts = ownerRawRows.map((row) => row.rawAmount)

  const topOwners = ownerRawRows.slice(0, 10).map((row) => {
    const supplyPercent = percentageFromRaw(row.rawAmount.toString(), rawSupply)
    return {
      owner: row.owner,
      supplyPercent,
      whale: Number(supplyPercent || 0) >= 5,
      explorerUrl: `https://solscan.io/account/${row.owner}`,
    }
  })

  const sumRaw = (count) => rawAmounts
    .slice(0, count)
    .reduce((sum, value) => {
      try { return sum + BigInt(value) } catch { return sum }
    }, 0n)

  let concentrationAvailable = false
  try {
    concentrationAvailable = largestAccounts.length > 0 && BigInt(rawSupply || '0') > 0n
  } catch {}

  const value = {
    available: Boolean(info),
    mintAuthority: info?.mintAuthority || null,
    freezeAuthority: info?.freezeAuthority || null,
    decimals: Number(info?.decimals ?? supply?.value?.decimals ?? 0),
    supply: rawSupply,
    isInitialized: info?.isInitialized !== false,
    concentrationAvailable,
    top1Percent: concentrationAvailable ? percentageFromRaw(sumRaw(1).toString(), rawSupply) : null,
    top5Percent: concentrationAvailable ? percentageFromRaw(sumRaw(5).toString(), rawSupply) : null,
    top10Percent: concentrationAvailable ? percentageFromRaw(sumRaw(10).toString(), rawSupply) : null,
    largestAccountCount: largestAccounts.length,
    ownerConcentrationAvailable: ownerRawAmounts.length > 0,
    top1OwnerPercent: ownerRawAmounts.length ? percentageFromRaw(ownerRawAmounts.slice(0,1).reduce((a,b)=>a+b,0n).toString(), rawSupply) : null,
    top5OwnerPercent: ownerRawAmounts.length ? percentageFromRaw(ownerRawAmounts.slice(0,5).reduce((a,b)=>a+b,0n).toString(), rawSupply) : null,
    top10OwnerPercent: ownerRawAmounts.length ? percentageFromRaw(ownerRawAmounts.slice(0,10).reduce((a,b)=>a+b,0n).toString(), rawSupply) : null,
    uniqueResolvedOwners: ownerRawAmounts.length,
    topOwners,
    supplyWhaleCount: topOwners.filter((row) => row.whale).length,
    concentrationMethod: ownerRawAmounts.length ? 'RESOLVED_TOKEN_ACCOUNT_OWNERS' : (concentrationAvailable ? 'TOKEN_ACCOUNTS' : 'UNAVAILABLE'),
    sources: {
      accountInfo: accountResult.status === 'fulfilled',
      largestAccounts: largestResult.status === 'fulfilled',
      largestAccountOwners: Boolean(largestOwnerResult),
      tokenSupply: supplyResult.status === 'fulfilled',
    },
  }

  const securityComplete = Boolean(info) && concentrationAvailable
  securityCache.set(address, {
    time: Date.now(),
    value,
    ttlMs: securityComplete ? SECURITY_TTL_MS : PARTIAL_SECURITY_TTL_MS,
  })
  return value
}

export async function getWalletSnapshot(address) {
  const [balance, classic, token2022] = await Promise.all([
    rpc('getBalance', [address, { commitment: 'confirmed' }]),
    rpc('getTokenAccountsByOwner', [
      address,
      { programId: TOKEN_PROGRAM },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]),
    rpc('getTokenAccountsByOwner', [
      address,
      { programId: TOKEN_2022_PROGRAM },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]),
  ])

  const accounts = [...(classic?.value || []), ...(token2022?.value || [])]
  const merged = new Map()

  for (const account of accounts) {
    const info = account?.account?.data?.parsed?.info
    const mint = info?.mint
    const amount = Number(info?.tokenAmount?.uiAmountString || 0)
    if (!mint || !Number.isFinite(amount) || amount <= 0) continue
    merged.set(mint, (merged.get(mint) || 0) + amount)
  }

  return {
    solBalance: Number(balance?.value || 0) / 1_000_000_000,
    holdings: [...merged.entries()].map(([mint, tokenBalance]) => ({
      mint,
      balance: tokenBalance,
    })),
  }
}
