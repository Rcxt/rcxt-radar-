import { getBestPair } from '../lib/dexscreener.js'
import { analyzePair } from '../lib/intelligence.js'
import { getMintSecurity, looksLikeSolanaAddress } from '../lib/solana.js'
import { logTokenScan } from '../lib/supabase-log.js'
import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'

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

  const address=String(getQuery(req, 'address')).trim()
  if (!looksLikeSolanaAddress(address)) return res.status(400).json({ success:false, error:'Enter a valid Solana token address.' })

  const shouldPersist = String(getQuery(req, 'persist', '1')) !== '0'

  try {
    const [pair,mintSecurity]=await Promise.all([getBestPair(address),getMintSecurity(address)])
    if (!pair) return res.status(404).json({ success:false, error:'No active DexScreener market found for this token.' })

    const intelligence=analyzePair(pair,mintSecurity)
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
      token:{name:pair?.baseToken?.name||'Unknown',symbol:pair?.baseToken?.symbol||'UNKNOWN',address},
      market:{
        priceUsd:Number(pair?.priceUsd||0),priceNative:Number(pair?.priceNative||0),
        marketCap:Number(pair?.marketCap||0),fdv:Number(pair?.fdv||0),
        liquidityUsd:liquidityReported?Number(rawLiquidity):null,
        liquidityReported,
        liquiditySource:intelligence.liquiditySource||null,
        volume:{m5:Number(pair?.volume?.m5||0),h1:Number(pair?.volume?.h1||0),h6:Number(pair?.volume?.h6||0),h24:Number(pair?.volume?.h24||0)},
        priceChange:{m5:Number(pair?.priceChange?.m5||0),h1:Number(pair?.priceChange?.h1||0),h6:Number(pair?.priceChange?.h6||0),h24:Number(pair?.priceChange?.h24||0)}
      },
      trading:{
        buys,sells,
        transactions:{m5:buys.m5+sells.m5,h1:buys.h1+sells.h1,h6:buys.h6+sells.h6,h24:buys.h24+sells.h24},
        buyPercent:intelligence.buyPercent24h
      },
      security:mintSecurity,
      pair:{dex:pair?.dexId||null,pairAddress:pair?.pairAddress||null,url:pair?.url||null,createdAt:pair?.pairCreatedAt||null},
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
