import { generateText } from 'ai'
import { logAiAnalysis } from '../lib/supabase-log.js'
import { rateLimit, applyRateHeaders } from '../lib/rate-limit.js'

function fallbackAnalysis(scan,social,mode='pro'){
  const intel=scan?.intelligence
  const positives=intel?.positives?.slice(0,3).join('; ')||'No strong positive signals.'
  const negatives=intel?.negatives?.slice(0,3).join('; ')||'No major negative signals.'
  const socialLine = social?.available
    ? `Social momentum ${social.momentumScore}/100 with quality ${social.qualityScore}/100 across ${social.sourceDiversity} source(s). Treat this as supporting evidence, not primary evidence.`
    : 'Social data is unavailable or not configured; do not infer social confirmation.'
  if(mode==='beginner'){
    const score=Number(intel?.score||0)
    const plain=score>=75
      ? 'Several parts of the setup look constructive, but it still needs risk checks.'
      : score>=55
        ? 'The setup is mixed. There are positives, but enough weaknesses that patience matters.'
        : 'The setup currently has more weakness or uncertainty than confirmation.'
    return [
      `BOTTOM LINE\n${intel?.signal||'WATCH'} · RCXT ${score}/100 · Opportunity ${intel?.opportunityScore??intel?.setupScore??'—'}/100 (${intel?.opportunityLabel||'mixed'}). ${plain}`,
      `WHY\n${positives}`,
      `WHAT COULD GO WRONG\n${negatives}`,
      `BEGINNER NOTE\nA score is not a win chance. Liquidity tells you how easy it may be to exit, seller pressure can change fast, and a good-looking chart cannot make contract risk disappear. ${socialLine}`
    ].join('\n\n')
  }

  return [
    `SIGNAL\n${intel?.signal||'WATCH'} — risk-adjusted score ${intel?.score??0}/100. Opportunity ${intel?.opportunityScore??intel?.setupScore??'—'}/100 (${intel?.opportunityLabel||'mixed'}), direction ${intel?.directionalBias||'NEUTRAL'}, execution ${intel?.executionScore??'—'}, safety ${intel?.safetyScore??'—'}, data quality ${intel?.dataQualityScore??'—'}.`,
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
  const marketContext=body?.marketContext || null
  const mode=body?.mode==='beginner'?'beginner':'pro'
  if(!scan?.address||!scan?.intelligence) return res.status(400).json({success:false,error:'Scan data is required.'})

  const compact={
    token:scan.token,
    market:scan.market,
    trading:scan.trading,
    security:scan.security,
    intelligence:scan.intelligence,
    chart:marketContext?.chart || null,
    tradeTape:marketContext?.tape || null,
    social,
    pair:scan.pair
  }

  const system=mode==='beginner'
    ? `You are RCXT Radar's beginner-friendly Solana market explainer.
Analyze only the supplied token snapshot. Use plain language a brand-new trader can understand.
Avoid unexplained jargon. If you use a term like liquidity, RSI, slippage, or market cap, explain it in a few words.
Never claim certainty, guaranteed profit, a win probability, insider information, or exact future prices.
The deterministic RCXT v4 signal is the source of truth.
Risk and direction are separate: a very young or thin-liquidity token can be extremely risky while momentum is still bullish. Never describe liquidity risk or pair age alone as proof price will fall. If liquidityReported is false, treat liquidity as unknown; for Pump.fun bonding-curve markets do not interpret missing AMM liquidity as literal $0 liquidity.
When candle analytics are supplied, explain chart bias, RSI, support/resistance, volatility, and forecast ranges in plain language.
When live trade tape is supplied, explain whether recent USD flow confirms or contradicts the token-level buy/sell counts.
Forecast ranges are scenario bands, not promised targets.
Use exactly four short sections: BOTTOM LINE, WHY, WHAT COULD GO WRONG, BEGINNER NOTE.
Explicitly say that score/confidence are not a probability of profit.
Social evidence is lower trust and must never override contract, liquidity, or execution risk.`
    : `You are RCXT Radar's market analyst. Analyze only the supplied Solana token snapshot.
Be concise, skeptical, and practical. Never claim certainty, guaranteed profit, insider knowledge, or future prices.
The deterministic RCXT v4 signal is the source of truth. It separates directional opportunity/setup from execution risk, safety, and data quality.
Risk is not the same as direction: thin liquidity, youth, or parabolic movement can coexist with bullish momentum. Do not turn those facts alone into a bearish forecast. If liquidityReported is false, explain that the liquidity field is unavailable; Pump.fun bonding-curve liquidity may not be represented as AMM pool liquidity.
Social data is lower-trust supporting evidence because it can be manipulated. Never let social momentum override contract, liquidity, execution, or market-structure risk.
Explain contradictions explicitly. A high social score with weak setup/execution should be treated as hype risk, not confirmation.
Use supplied candle regime, support/resistance, forecast ranges, and live trade tape as additional evidence.
If chart/trade-tape evidence conflicts with the RCXT signal, explicitly call that out and lower the language of conviction.
Forecast bands are volatility scenarios, not exact price predictions.
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

  const analysis=fallbackAnalysis(scan,social,mode)
  await logAiAnalysis(
    {scan,model:'deterministic-fallback-v4.2',analysis,social},
    req.headers?.['x-vercel-oidc-token']
  )
  return res.status(200).json({
    success:true,
    model:'deterministic-fallback-v4.2',
    analysis,
    gatewayAvailable:false
  })
}
