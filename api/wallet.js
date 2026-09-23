import { getBestPair, getPairsForTokens } from '../lib/dexscreener.js'
import { analyzePair } from '../lib/intelligence.js'
import { getWalletSnapshot, looksLikeSolanaAddress } from '../lib/solana.js'
import { logWalletSnapshot } from '../lib/supabase-log.js'
import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'

const WRAPPED_SOL = 'So11111111111111111111111111111111111111112'

function getQuery(req, name, fallback = '') {
  try {
    const url = new URL(req.url || '/', 'https://rcxt.local')
    return url.searchParams.get(name) ?? fallback
  } catch {
    return fallback
  }
}

export default async function handler(req,res){
  if (req.method !== 'GET') return res.status(405).json({success:false,error:'Method not allowed'})

  const limited = rateLimit(req, { key:'wallet', limit:30, windowMs:60_000 })
  applyRateHeaders(res, limited, 30)
  if (!limited.allowed) return res.status(429).json({success:false,error:'Too many wallet requests. Try again shortly.'})

  const address=String(getQuery(req, 'address')).trim()
  if (!looksLikeSolanaAddress(address)) {
    return res.status(400).json({success:false,error:'Enter a valid Solana wallet address.'})
  }

  try{
    const snapshot=await getWalletSnapshot(address)
    const [pairs, solPair]=await Promise.all([
      getPairsForTokens(snapshot.holdings.map(item=>item.mint)),
      getBestPair(WRAPPED_SOL),
    ])

    let portfolioTokenValueUsd=0
    let pricedTokenCount=0

    const holdings=snapshot.holdings.map((holding)=>{
      const pair=pairs.get(holding.mint)
      const priceUsd=Number(pair?.priceUsd||0)
      const valueUsd=holding.balance*priceUsd
      if (priceUsd > 0) pricedTokenCount += 1
      portfolioTokenValueUsd+=valueUsd

      const intelligence=pair?analyzePair(pair,null):null
      const liquidityReported=intelligence?.liquidityReported !== false
      return {
        mint:holding.mint,
        balance:holding.balance,
        name:pair?.baseToken?.name||null,
        symbol:pair?.baseToken?.symbol||null,
        priceUsd,
        valueUsd,
        marketCap:Number(pair?.marketCap||0),
        liquidityUsd:pair && liquidityReported ? Number(pair?.liquidity?.usd||0) : null,
        liquidityReported:pair ? liquidityReported : false,
        liquiditySource:intelligence?.liquiditySource||null,
        change24h:Number(pair?.priceChange?.h24||0),
        volume24h:Number(pair?.volume?.h24||0),
        pairUrl:pair?.url||null,
        intelligence
      }
    }).sort((a,b)=>b.valueUsd-a.valueUsd)

    const solPriceUsd=Number(solPair?.priceUsd||0)
    const solValueUsd=snapshot.solBalance*solPriceUsd
    const portfolioTotalUsd=portfolioTokenValueUsd+solValueUsd

    const result={
      success:true,
      scannedAt:new Date().toISOString(),
      wallet:address,
      solBalance:snapshot.solBalance,
      solPriceUsd,
      solValueUsd,
      tokenCount:holdings.length,
      pricedTokenCount,
      portfolioTokenValueUsd,
      portfolioTotalUsd,
      holdings,
    }

    const persistence=await Promise.race([
      logWalletSnapshot(result, req.headers?.['x-vercel-oidc-token']),
      new Promise(resolve=>setTimeout(()=>resolve({ok:false,status:0,error:'Persistence timeout'}),1800))
    ])

    res.setHeader('Cache-Control','no-store')
    return res.status(200).json({ ...result, persistence })
  }catch(error){
    return res.status(500).json({success:false,error:error?.message||'Wallet load failed.'})
  }
}
