import { generateText } from 'ai'
import { logTokenScan } from '../lib/supabase-log.js'
import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'

function fallbackAnalysis(scan){
  const intel=scan?.intelligence
  const positives=intel?.positives?.slice(0,3).join('; ')||'No strong positive signals.'
  const negatives=intel?.negatives?.slice(0,3).join('; ')||'No major negative signals.'
  return [
    `SIGNAL\n${intel?.signal||'WATCH'} — score ${intel?.score??0}/100 with ${intel?.confidence??0}% data confidence.`,
    `WHY\n${positives}`,
    `INVALIDATION\n${negatives}`,
    'RISK\nWait for confirmation from liquidity, order flow, and momentum rather than chasing one candle. This is market intelligence, not a guaranteed outcome.'
  ].join('\n\n')
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({success:false,error:'Method not allowed'})

  const limited=rateLimit(req,{key:'ai',limit:12,windowMs:60_000})
  applyRateHeaders(res,limited,12)
  if(!limited.allowed) return res.status(429).json({success:false,error:'AI analysis rate limit reached. Try again shortly.'})

  let body=req.body
  if(typeof body==='string'){
    if(body.length>150_000) return res.status(413).json({success:false,error:'Request too large'})
    try{body=JSON.parse(body)}catch{return res.status(400).json({success:false,error:'Invalid JSON'})}
  }

  const scan=body?.scan
  if(!scan?.address||!scan?.intelligence) return res.status(400).json({success:false,error:'Scan data is required.'})

  const compact={
    token:scan.token,
    market:scan.market,
    trading:scan.trading,
    security:scan.security,
    intelligence:scan.intelligence,
    pair:scan.pair
  }

  const system=`You are RCXT Radar's market analyst. Analyze only the supplied Solana token snapshot.
Be concise, skeptical, and practical. Never claim certainty, guaranteed profit, insider knowledge, or future prices.
The deterministic RCXT signal is the source of truth. Explain it, point out contradictions, and describe what would strengthen or invalidate it.
Treat preliminary/unverified contract data as a limitation. If risk flags conflict with bullish activity, emphasize the risk.
Use exactly four short sections: SIGNAL, WHY, INVALIDATION, RISK.
Do not tell the user to risk money they cannot afford to lose.`

  try{
    const {text}=await generateText({
      model:'openai/gpt-5.6-sol',
      system,
      prompt:JSON.stringify(compact),
      maxOutputTokens:500
    })
    await logTokenScan(scan,text)
    return res.status(200).json({success:true,model:'openai/gpt-5.6-sol',analysis:text})
  }catch(error){
    const analysis=fallbackAnalysis(scan)
    return res.status(200).json({
      success:true,
      model:'deterministic-fallback',
      analysis,
      gatewayAvailable:false
    })
  }
}
