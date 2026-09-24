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

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function extensionRows(info, parsedData) {
  const rows = [
    ...(Array.isArray(info?.extensions) ? info.extensions : []),
    ...(Array.isArray(parsedData?.extensions) ? parsedData.extensions : []),
    ...(Array.isArray(parsedData?.info?.extensions) ? parsedData.info.extensions : []),
  ]
  const seen = new Set()
  return rows.filter((row) => {
    if (!row || typeof row !== 'object') return false
    const key = JSON.stringify(row)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function extensionType(row) {
  return String(
    row?.extension ??
    row?.extensionType ??
    row?.type ??
    row?.name ??
    ''
  ).replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function extensionState(row) {
  if (!row || typeof row !== 'object') return {}
  if (row.state && typeof row.state === 'object') return row.state
  if (row.config && typeof row.config === 'object') return row.config
  return row
}

function addressOrNull(value) {
  if (!value) return null
  if (typeof value === 'string') return looksLikeSolanaAddress(value) ? value : null
  if (typeof value === 'object') {
    return addressOrNull(value.address ?? value.pubkey ?? value.value ?? value.authority ?? null)
  }
  return null
}

export function parseToken2022Extensions(info = {}, parsedData = {}) {
  const rows = extensionRows(info, parsedData)
  const find = (name) => rows.find((row) => extensionType(row) === name)
  const findIncludes = (name) => rows.find((row) => extensionType(row).includes(name))

  const transferFeeRow = find('transferfeeconfig') || findIncludes('transferfeeconfig')
  const transferFeeState = extensionState(transferFeeRow)
  const newerTransferFee =
    transferFeeState?.newerTransferFee ??
    transferFeeState?.newer_transfer_fee ??
    transferFeeState?.transferFee ??
    transferFeeState?.transfer_fee ??
    {}
  const transferFeeBasisPoints = finiteNumber(
    newerTransferFee?.transferFeeBasisPoints ??
    newerTransferFee?.transfer_fee_basis_points ??
    transferFeeState?.transferFeeBasisPoints ??
    transferFeeState?.transfer_fee_basis_points
  )
  const maximumFeeRaw =
    newerTransferFee?.maximumFee ??
    newerTransferFee?.maximum_fee ??
    transferFeeState?.maximumFee ??
    transferFeeState?.maximum_fee ??
    null

  const delegateRow = find('permanentdelegate') || findIncludes('permanentdelegate')
  const delegateState = extensionState(delegateRow)
  const permanentDelegate = addressOrNull(
    delegateState?.delegate ?? delegateRow?.delegate ?? delegateState?.authority
  )

  const hookRow = find('transferhook') || findIncludes('transferhook')
  const hookState = extensionState(hookRow)
  const transferHookProgramId = addressOrNull(
    hookState?.programId ??
    hookState?.program_id ??
    hookState?.program ??
    hookRow?.programId ??
    hookRow?.program_id
  )

  const defaultRow = find('defaultaccountstate') || findIncludes('defaultaccountstate')
  const defaultState = extensionState(defaultRow)
  const defaultAccountStateRaw =
    defaultState?.state ??
    defaultState?.accountState ??
    defaultState?.account_state ??
    defaultRow?.state ??
    null
  const normalizedDefaultState = String(defaultAccountStateRaw ?? '').trim().toLowerCase()
  const defaultAccountFrozen =
    normalizedDefaultState === 'frozen' ||
    normalizedDefaultState === '2'

  const nonTransferable = Boolean(find('nontransferable') || findIncludes('nontransferable'))
  const pausableRow = find('pausable') || findIncludes('pausable')
  const pausableState = extensionState(pausableRow)
  const pauseAuthority = addressOrNull(
    pausableState?.authority ??
    pausableState?.pauseAuthority ??
    pausableState?.pause_authority
  )
  const paused =
    pausableState?.paused === true ||
    String(pausableState?.paused ?? '').toLowerCase() === 'true' ||
    String(pausableState?.state ?? '').toLowerCase() === 'paused'

  const closeRow = find('mintcloseauthority') || findIncludes('mintcloseauthority')
  const closeState = extensionState(closeRow)
  const mintCloseAuthority = addressOrNull(
    closeState?.closeAuthority ??
    closeState?.close_authority ??
    closeState?.authority
  )

  return {
    available:rows.length > 0,
    types:[...new Set(rows.map(extensionType).filter(Boolean))],
    transferFeeEnabled:Boolean(transferFeeRow),
    transferFeeBasisPoints,
    maximumFeeRaw:maximumFeeRaw == null ? null : String(maximumFeeRaw),
    permanentDelegate,
    transferHookProgramId,
    defaultAccountState:defaultAccountStateRaw == null ? null : String(defaultAccountStateRaw),
    defaultAccountFrozen,
    nonTransferable,
    pauseAuthority,
    paused,
    mintCloseAuthority,
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

  const parsedMintData = account?.value?.data?.parsed
  const info = parsedMintData?.info
  const tokenProgram = account?.value?.owner || null
  const token2022Extensions = parseToken2022Extensions(info || {}, parsedMintData || {})
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
  let resolvedLargestAccountCount = 0
  const ownerRows = Array.isArray(largestOwnerResult?.value) ? largestOwnerResult.value : []
  ownerRows.forEach((account, index) => {
    const owner = account?.data?.parsed?.info?.owner
    const raw = rawAmounts[index] || '0'
    if (!owner) return
    resolvedLargestAccountCount += 1
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

  const topAccountRawTotal = sumRaw(Math.min(20, rawAmounts.length))
  const resolvedOwnerRawTotal = ownerRawAmounts.reduce((sum,value)=>sum+value,0n)
  const ownerResolutionCoveragePercent = topAccountRawTotal > 0n
    ? Number((resolvedOwnerRawTotal * 10_000n) / topAccountRawTotal) / 100
    : 0
  // A partial getMultipleAccounts response can otherwise make the resolved top-10
  // look artificially distributed. Only promote owner-level concentration when
  // most of the value in the top accounts was actually mapped to an owner.
  const ownerResolutionComplete =
    ownerRawAmounts.length > 0 &&
    ownerResolutionCoveragePercent >= 85

  const value = {
    available: Boolean(info),
    tokenProgram,
    token2022: tokenProgram === TOKEN_2022_PROGRAM || token2022Extensions.available,
    token2022Extensions,
    transferFeeEnabled:token2022Extensions.transferFeeEnabled,
    transferFeeBasisPoints:token2022Extensions.transferFeeBasisPoints,
    permanentDelegate:token2022Extensions.permanentDelegate,
    transferHookProgramId:token2022Extensions.transferHookProgramId,
    defaultAccountFrozen:token2022Extensions.defaultAccountFrozen,
    nonTransferable:token2022Extensions.nonTransferable,
    pauseAuthority:token2022Extensions.pauseAuthority,
    paused:token2022Extensions.paused,
    mintCloseAuthority:token2022Extensions.mintCloseAuthority,
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
    ownerConcentrationAvailable: ownerResolutionComplete,
    ownerResolutionCoveragePercent,
    ownerResolutionComplete,
    resolvedLargestAccountCount,
    top1OwnerPercent: ownerRawAmounts.length ? percentageFromRaw(ownerRawAmounts.slice(0,1).reduce((a,b)=>a+b,0n).toString(), rawSupply) : null,
    top5OwnerPercent: ownerRawAmounts.length ? percentageFromRaw(ownerRawAmounts.slice(0,5).reduce((a,b)=>a+b,0n).toString(), rawSupply) : null,
    top10OwnerPercent: ownerRawAmounts.length ? percentageFromRaw(ownerRawAmounts.slice(0,10).reduce((a,b)=>a+b,0n).toString(), rawSupply) : null,
    uniqueResolvedOwners: ownerRawAmounts.length,
    topOwners,
    supplyWhaleCount: topOwners.filter((row) => row.whale).length,
    concentrationMethod: ownerResolutionComplete ? 'RESOLVED_TOKEN_ACCOUNT_OWNERS' : (concentrationAvailable ? 'TOKEN_ACCOUNTS' : 'UNAVAILABLE'),
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
