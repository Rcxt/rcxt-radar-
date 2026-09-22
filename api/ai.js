import { generateText } from 'ai'
import { logAiAnalysis } from '../lib/supabase-log.js'
import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'

function fallbackAnalysis(scan,social){
  const intel=scan?.intelligence
  const positives=intel?.positives?.slice(0,3).join('; ')||'No strong positive signals.'
  const negatives=intel?.negatives?.slice(0,3).join('; ')||'No major negative signals.'
  const socialLine = social?.available
    ? `Social momentum ${social.momentumScore}/100 with quality ${social.qualityScore}/100 across ${social.sourceDiversity} source(s). Treat this as supporting evidence, not primary evidence.`
    : 'Social data is unavailable or not configured; do not infer social confirmation.'
  return [
    `SIGNAL\n${intel?.signal||'WATCH'} — risk-adjusted score ${intel?.score??0}/100. Setup ${intel?.setupScore??'—'}, execution ${intel?.executionScore??'—'}, safety ${intel?.safetyScore??'—'}, data quality ${intel?.dataQualityScore??'—'}.`,
    `WHY\n${positives}\n${socialLine}`,
    `INVALIDATION\n${negatives}`,
    'RISK\nTreat RCXT as decision support, not a profit forecast. Liquidity, contract risk, slippage, and changing market structure can invalidate the setup quickly.'
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
  const social=body?.social || null
  if(!scan?.address||!scan?.intelligence) return res.status(400).json({success:false,error:'Scan data is required.'})

  const compact={
    token:scan.token,
    market:scan.market,
    trading:scan.trading,
    security:scan.security,
    intelligence:scan.intelligence,
    social,
    pair:scan.pair
  }

  const system=`You are RCXT Radar's market analyst. Analyze only the supplied Solana token snapshot.
Be concise, skeptical, and practical. Never claim certainty, guaranteed profit, insider knowledge, or future prices.
The deterministic RCXT v4 signal is the source of truth. It separates setup, execution, safety, and data quality.
Social data is lower-trust supporting evidence because it can be manipulated. Never let social momentum override contract, liquidity, execution, or market-structure risk.
Explain contradictions explicitly. A high social score with weak setup/execution should be treated as hype risk, not confirmation.
Treat preliminary/unverified contract or concentration data as a limitation.
Use exactly four short sections: SIGNAL, WHY, INVALIDATION, RISK.
Never claim probability of profit, guaranteed returns, insider information, or certainty.`

  const models=['openai/gpt-5.6-sol','openai/gpt-5.6-luna']
  for(const model of models){
    try{
      const {text}=await generateText({
        model,
        system,
        prompt:JSON.stringify(compact),
        maxOutputTokens:650
      })
      await logAiAnalysis(
        {scan,model,analysis:text,social},
        req.headers?.['x-vercel-oidc-token']
      )
      return res.status(200).json({success:true,model,analysis:text,gatewayAvailable:true})
    }catch{}
  }

  const analysis=fallbackAnalysis(scan,social)
  await logAiAnalysis(
    {scan,model:'deterministic-fallback-v4',analysis,social},
    req.headers?.['x-vercel-oidc-token']
  )
  return res.status(200).json({
    success:true,
    model:'deterministic-fallback-v4',
    analysis,
    gatewayAvailable:false
  })
}
