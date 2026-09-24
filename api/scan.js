import { getBestPair, resolveDexChain } from '../lib/dexscreener.js'
import { analyzePair } from '../lib/intelligence.js'
import { getMintSecurity, looksLikeSolanaAddress } from '../lib/solana.js'
import { getEvmSecurity } from '../lib/evm-security.js'
import { getChain, isAddressValidForChain, looksLikeEvmAddress, normalizeTokenAddress, SUPPORTED_CHAIN_IDS } from '../lib/chains.js'
import { getExternalSecurity, mergeSecurityEvidence } from '../lib/external-security.js'
import { buildMarketConsensus, getMarketConsensus } from '../lib/market-consensus.js'
import { logTokenScan } from '../lib/supabase-log.js'
import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'
import { getTradeQuality } from '../lib/trade-quality.js'

function getQuery(req, name, fallback = '') {
  try {
    const url = new URL(req.url || '/', 'https://rcxt.local')
    return url.searchParams.get(name) ?? fallback
  } catch {
    return fallback
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success:false, error:'Method not allowed' })

  const limited = rateLimit(req, { key:'scan', limit:90, windowMs:60_000 })
  applyRateHeaders(res, limited, 90)
  if (!limited.allowed) return res.status(429).json({ success:false, error:'Too many scan requests. Try again shortly.' })

  const rawAddress=String(getQuery(req, 'address')).trim()
  const requestedChain=String(getQuery(req, 'chain', 'auto')).trim().toLowerCase() || 'auto'
  if (!looksLikeSolanaAddress(rawAddress) && !looksLikeEvmAddress(rawAddress)) {
    return res.status(400).json({ success:false, error:'Enter a valid Solana or EVM token contract address.' })
  }

  let chain = requestedChain === 'auto' ? null : getChain(requestedChain)
  if (requestedChain !== 'auto' && !chain) {
    return res.status(400).json({ success:false, error:`Unsupported chain. Choose one of: ${SUPPORTED_CHAIN_IDS.join(', ')}` })
  }

  if (!chain) {
    chain = looksLikeSolanaAddress(rawAddress) ? getChain('solana') : await resolveDexChain(rawAddress)
  }
  if (!chain) {
    return res.status(404).json({ success:false, error:'Could not identify an active supported chain for this contract. Select the chain manually.' })
  }
  if (!isAddressValidForChain(rawAddress,chain)) {
    return res.status(400).json({ success:false, error:`That address is not valid for ${chain.label}.` })
  }

  const address=normalizeTokenAddress(rawAddress,chain)
  const autoDetected=requestedChain==='auto'
  const shouldPersist = String(getQuery(req, 'persist', '1')) !== '0'

  try {
    const [pair,onchainSecurity,externalSecurity,externalMarket]=await Promise.all([
      getBestPair(address,chain),
      chain.family === 'evm' ? getEvmSecurity(address,chain) : getMintSecurity(address),
      getExternalSecurity(address,chain),
      getMarketConsensus(address,null,chain),
    ])
    if (!pair) return res.status(404).json({ success:false, error:'No active DexScreener market found for this token.' })

    let marketEvidence=buildMarketConsensus(pair,externalMarket?.providers || {})
    let mintSecurity=mergeSecurityEvidence(onchainSecurity,externalSecurity,marketEvidence)
    let intelligence=analyzePair(pair,mintSecurity)

    // Only add the heavier wallet-level trade-tape check when the setup is
    // otherwise strong enough to approach an entry promotion. It is used as
    // negative/confirmation evidence, never as a standalone score booster.
    if (
      pair?.pairAddress &&
      (Number(intelligence?.setupScore || 0) >= 55 || Number(intelligence?.score || 0) >= 55)
    ) {
      const tradeQuality=await getTradeQuality(pair.pairAddress,chain)
      marketEvidence={...marketEvidence,tradeQuality}
      mintSecurity=mergeSecurityEvidence(onchainSecurity,externalSecurity,marketEvidence)
      intelligence=analyzePair(pair,mintSecurity)
    }
    const rawLiquidity=pair?.liquidity?.usd
    const pumpFunMarket=String(pair?.dexId||'').toLowerCase()==='pumpfun'
    const rawLiquidityFinite=rawLiquidity!==null&&rawLiquidity!==undefined&&rawLiquidity!==''&&Number.isFinite(Number(rawLiquidity))
    const liquidityReported=pumpFunMarket
      ? rawLiquidityFinite&&Number(rawLiquidity)>0
      : rawLiquidityFinite
    const buys={m5:Number(pair?.txns?.m5?.buys||0),h1:Number(pair?.txns?.h1?.buys||0),h6:Number(pair?.txns?.h6?.buys||0),h24:Number(pair?.txns?.h24?.buys||0)}
    const sells={m5:Number(pair?.txns?.m5?.sells||0),h1:Number(pair?.txns?.h1?.sells||0),h6:Number(pair?.txns?.h6?.sells||0),h24:Number(pair?.txns?.h24?.sells||0)}
    const scan={
      address,
      chain:{
        id:chain.id,
        label:chain.label,
        family:chain.family,
        chainId:chain.chainId ?? null,
        autoDetected,
        explorerUrl:chain.explorer ? `${chain.explorer}${address}` : null,
      },
      token:{name:pair?.baseToken?.name||'Unknown',symbol:pair?.baseToken?.symbol||'UNKNOWN',address},
      market:{
        priceUsd:Number(pair?.priceUsd||0),priceNative:Number(pair?.priceNative||0),
        marketCap:Number(pair?.marketCap||0),fdv:Number(pair?.fdv||0),
        liquidityUsd:liquidityReported?Number(rawLiquidity):null,
        liquidityReported,
        liquiditySource:intelligence.liquiditySource||null,
        volume:{m5:Number(pair?.volume?.m5||0),h1:Number(pair?.volume?.h1||0),h6:Number(pair?.volume?.h6||0),h24:Number(pair?.volume?.h24||0)},
        priceChange:{m5:Number(pair?.priceChange?.m5||0),h1:Number(pair?.priceChange?.h1||0),h6:Number(pair?.priceChange?.h6||0),h24:Number(pair?.priceChange?.h24||0)},
        consensus:marketEvidence
      },
      trading:{
        buys,sells,
        transactions:{m5:buys.m5+sells.m5,h1:buys.h1+sells.h1,h6:buys.h6+sells.h6,h24:buys.h24+sells.h24},
        buyPercent:intelligence.buyPercent24h
      },
      security:mintSecurity,
      pair:{chain:pair?.chainId||chain.dexscreener,dex:pair?.dexId||null,pairAddress:pair?.pairAddress||null,url:pair?.url||null,createdAt:pair?.pairCreatedAt||null},
      intelligence
    }

    const persistence = shouldPersist
      ? await Promise.race([
          logTokenScan(scan, null, req.headers?.['x-vercel-oidc-token']),
          new Promise(resolve=>setTimeout(()=>resolve({ok:false,status:0,error:'Persistence timeout'}),1800))
        ])
      : { ok:true, skipped:true, status:0, error:null }

    res.setHeader('Cache-Control','no-store')
    return res.status(200).json({ success:true, scannedAt:new Date().toISOString(), persistence, scan })
  } catch (error) {
    return res.status(500).json({ success:false, error:error?.message || 'Token scan failed.' })
  }
}
