import { getPairsForTokens } from '../lib/dexscreener.js'
import { analyzePair } from '../lib/intelligence.js'
import { getWalletSnapshot, looksLikeSolanaAddress } from '../lib/solana.js'
import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'

export default async function handler(req,res){
  if (req.method !== 'GET') return res.status(405).json({success:false,error:'Method not allowed'})

  const limited = rateLimit(req, { key:'wallet', limit:30, windowMs:60_000 })
  applyRateHeaders(res, limited, 30)
  if (!limited.allowed) return res.status(429).json({success:false,error:'Too many wallet requests. Try again shortly.'})

  const address=String(req.query?.address || '').trim()
  if (!looksLikeSolanaAddress(address)) return res.status(400).json({success:false,error:'Enter a valid Solana wallet address.'})

  try{
    const snapshot=await getWalletSnapshot(address)
    const pairs=await getPairsForTokens(snapshot.holdings.map(item=>item.mint))
    let portfolioTokenValueUsd=0

    const holdings=snapshot.holdings.map((holding)=>{
      const pair=pairs.get(holding.mint)
      const priceUsd=Number(pair?.priceUsd||0)
      const valueUsd=holding.balance*priceUsd
      portfolioTokenValueUsd+=valueUsd
      return {
        mint:holding.mint,balance:holding.balance,
        name:pair?.baseToken?.name||null,symbol:pair?.baseToken?.symbol||null,
        priceUsd,valueUsd,marketCap:Number(pair?.marketCap||0),
        liquidityUsd:Number(pair?.liquidity?.usd||0),change24h:Number(pair?.priceChange?.h24||0),
        volume24h:Number(pair?.volume?.h24||0),pairUrl:pair?.url||null,
        intelligence:pair?analyzePair(pair,null):null
      }
    }).sort((a,b)=>b.valueUsd-a.valueUsd)

    res.setHeader('Cache-Control','no-store')
    return res.status(200).json({
      success:true,scannedAt:new Date().toISOString(),wallet:address,
      solBalance:snapshot.solBalance,tokenCount:holdings.length,portfolioTokenValueUsd,holdings
    })
  }catch(error){
    return res.status(500).json({success:false,error:error?.message||'Wallet load failed.'})
  }
}
