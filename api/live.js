import { getBestPair, hasMeaningfulChainAmbiguity, resolveDexChainCandidates } from '../lib/dexscreener.js'
import { getChain, isAddressValidForChain, looksLikeEvmAddress, normalizeTokenAddress, SUPPORTED_CHAIN_IDS } from '../lib/chains.js'
import { looksLikeSolanaAddress } from '../lib/solana.js'
import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'

function getQuery(req, name, fallback = '') {
  try {
    const url = new URL(req.url || '/', 'https://rcxt.local')
    return url.searchParams.get(name) ?? fallback
  } catch {
    return fallback
  }
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function sumKnown(a, b) {
  return a === null || b === null ? null : a + b
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success:false, error:'Method not allowed' })
  }

  // V7 lightweight lane: this endpoint is intentionally allowed to refresh much
  // more often than a full security/consensus scan.
  const limited = rateLimit(req, { key:'live-quote', limit:240, windowMs:60_000 })
  applyRateHeaders(res, limited, 240)
  if (!limited.allowed) {
    return res.status(429).json({ success:false, error:'Too many live refresh requests. Try again shortly.' })
  }

  const rawAddress = String(getQuery(req, 'address')).trim()
  const requestedChain = String(getQuery(req, 'chain', 'auto')).trim().toLowerCase() || 'auto'

  if (!looksLikeSolanaAddress(rawAddress) && !looksLikeEvmAddress(rawAddress)) {
    return res.status(400).json({ success:false, error:'Enter a valid Solana or EVM token contract address.' })
  }

  let chain = requestedChain === 'auto' ? null : getChain(requestedChain)
  if (requestedChain !== 'auto' && !chain) {
    return res.status(400).json({
      success:false,
      error:`Unsupported chain. Choose one of: ${SUPPORTED_CHAIN_IDS.join(', ')}`,
    })
  }

  if (!chain) {
    if (looksLikeSolanaAddress(rawAddress)) {
      chain = getChain('solana')
    } else {
      const candidates = await resolveDexChainCandidates(rawAddress)
      if (hasMeaningfulChainAmbiguity(candidates)) {
        return res.status(409).json({
          success:false,
          error:'This contract has meaningful markets on multiple supported chains. Select the network manually.',
          chainCandidates:candidates.slice(0, 5).map((candidate) => ({
            id:candidate.chain.id,
            label:candidate.chain.label,
            liquidityUsd:candidate.liquidityUsd,
            volume24hUsd:candidate.volume24hUsd,
          })),
        })
      }
      chain = candidates[0]?.chain || null
    }
  }

  if (!chain) {
    return res.status(404).json({ success:false, error:'Could not identify an active supported chain for this contract.' })
  }

  if (!isAddressValidForChain(rawAddress, chain)) {
    return res.status(400).json({ success:false, error:`That address is not valid for ${chain.label}.` })
  }

  const address = normalizeTokenAddress(rawAddress, chain)

  try {
    const pair = await getBestPair(address, chain, { freshMs:1800, staleMs:45_000 })
    if (!pair) {
      return res.status(404).json({ success:false, error:'No active DexScreener market found for this token.' })
    }

    const rawLiquidity = pair?.liquidity?.usd
    const pumpFunMarket = String(pair?.dexId || '').toLowerCase() === 'pumpfun'
    const rawLiquidityFinite =
      rawLiquidity !== null &&
      rawLiquidity !== undefined &&
      rawLiquidity !== '' &&
      Number.isFinite(Number(rawLiquidity))
    const liquidityReported = pumpFunMarket
      ? rawLiquidityFinite && Number(rawLiquidity) > 0
      : rawLiquidityFinite

    const buys = {
      m5:finiteOrNull(pair?.txns?.m5?.buys),
      h1:finiteOrNull(pair?.txns?.h1?.buys),
      h6:finiteOrNull(pair?.txns?.h6?.buys),
      h24:finiteOrNull(pair?.txns?.h24?.buys),
    }
    const sells = {
      m5:finiteOrNull(pair?.txns?.m5?.sells),
      h1:finiteOrNull(pair?.txns?.h1?.sells),
      h6:finiteOrNull(pair?.txns?.h6?.sells),
      h24:finiteOrNull(pair?.txns?.h24?.sells),
    }

    const total24 = sumKnown(buys.h24, sells.h24)
    const buyPercent = total24 && buys.h24 !== null
      ? Math.round((buys.h24 / total24) * 1000) / 10
      : null

    const snapshot = {
      address,
      chain:{
        id:chain.id,
        label:chain.label,
        family:chain.family,
        chainId:chain.chainId ?? null,
      },
      token:{
        name:pair?.baseToken?.name || 'Unknown',
        symbol:pair?.baseToken?.symbol || 'UNKNOWN',
        address,
      },
      market:{
        priceUsd:finiteOrNull(pair?.priceUsd),
        priceNative:finiteOrNull(pair?.priceNative),
        marketCap:finiteOrNull(pair?.marketCap),
        fdv:finiteOrNull(pair?.fdv),
        liquidityUsd:liquidityReported ? finiteOrNull(rawLiquidity) : null,
        liquidityReported,
        volume:{
          m5:finiteOrNull(pair?.volume?.m5),
          h1:finiteOrNull(pair?.volume?.h1),
          h6:finiteOrNull(pair?.volume?.h6),
          h24:finiteOrNull(pair?.volume?.h24),
        },
        priceChange:{
          m5:finiteOrNull(pair?.priceChange?.m5),
          h1:finiteOrNull(pair?.priceChange?.h1),
          h6:finiteOrNull(pair?.priceChange?.h6),
          h24:finiteOrNull(pair?.priceChange?.h24),
        },
      },
      trading:{
        buys,
        sells,
        transactions:{
          m5:sumKnown(buys.m5, sells.m5),
          h1:sumKnown(buys.h1, sells.h1),
          h6:sumKnown(buys.h6, sells.h6),
          h24:total24,
        },
        buyPercent,
      },
      pair:{
        chain:pair?.chainId || chain.dexscreener,
        dex:pair?.dexId || null,
        pairAddress:pair?.pairAddress || null,
        url:pair?.url || null,
        createdAt:pair?.pairCreatedAt || null,
      },
    }

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({
      success:true,
      liveAt:new Date().toISOString(),
      source:'dexscreener',
      snapshot,
    })
  } catch (error) {
    return res.status(500).json({ success:false, error:error?.message || 'Live quote refresh failed.' })
  }
}
