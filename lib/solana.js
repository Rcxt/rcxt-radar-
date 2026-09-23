const RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const SECURITY_TTL_MS = 5 * 60 * 1000
const securityCache = new Map()

export function looksLikeSolanaAddress(value) {
  return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim())
}

export async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'rcxt-radar', method, params }),
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) throw new Error(`Solana RPC HTTP ${response.status}`)
  const data = await response.json()
  if (data.error) throw new Error(data.error.message || 'Solana RPC error')
  return data.result
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
  if (cached && Date.now() - cached.time < SECURITY_TTL_MS) return cached.value

  const [accountResult, largestResult, supplyResult] = await Promise.allSettled([
    rpc('getAccountInfo', [address, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
    rpc('getTokenLargestAccounts', [address, { commitment: 'confirmed' }]),
    rpc('getTokenSupply', [address, { commitment: 'confirmed' }]),
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

  const ownerRawAmounts = [...ownerAmounts.values()].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))

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
    concentrationMethod: ownerRawAmounts.length ? 'RESOLVED_TOKEN_ACCOUNT_OWNERS' : (concentrationAvailable ? 'TOKEN_ACCOUNTS' : 'UNAVAILABLE'),
    sources: {
      accountInfo: accountResult.status === 'fulfilled',
      largestAccounts: largestResult.status === 'fulfilled',
      largestAccountOwners: Boolean(largestOwnerResult),
      tokenSupply: supplyResult.status === 'fulfilled',
    },
  }

  securityCache.set(address, { time: Date.now(), value })
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
