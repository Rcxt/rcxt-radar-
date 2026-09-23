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

function fallbackSocialAnalysis(scan,social){
  const x=social?.x||social?.providers?.find?.((provider)=>provider?.source==='x')||{}
  const narratives=(x?.narratives||[]).slice(0,5).map((item)=>item.term).join(', ')||'No dominant narrative cluster yet.'
  const catalysts=(x?.catalysts||[]).slice(0,4).map((item)=>item.term+' '+item.count+'x').join(', ')||'No repeated catalyst phrases detected.'
  const riskClaims=(x?.riskClaims||[]).slice(0,4).map((item)=>item.term+' '+item.count+'x').join(', ')||'No repeated risk claims detected.'
  const signal=social?.signal||'QUIET'
  const momentum=Number(social?.momentumScore||0)
  const quality=Number(social?.qualityScore||0)
  const organic=Number(social?.organicScore||0)
  const shill=social?.shillRisk||'UNKNOWN'
  const accel=Number(social?.accelerationRatio||0).toFixed(1)
  const mentions=Number(social?.mentionCount||0)
  const authors=Number(social?.uniqueAuthors||0)

  return [
    'X PULSE\n'+signal+' · momentum '+momentum+'/100 · quality '+quality+'/100 · '+mentions+' relevant posts from '+authors+' authors · '+accel+'x mention-rate acceleration.',
    'WHAT X IS SAYING\nNarratives: '+narratives+'. Repeated catalyst chatter: '+catalysts+'.',
    'QUALITY CHECK\nOrganic score '+organic+'/100 · shill/coordination risk '+shill+'. Duplicate text, concentrated authors and low-follower/new-account activity are treated as manipulation risk signals, not proof of bots.',
    'WHAT TO WATCH\nRepeated risk claims on X: '+riskClaims+'. These are unverified claims from social posts. Confirm them with contract, wallet, market and primary-source evidence before acting.'
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
  const requestedMode=String(body?.mode||'pro')
  const mode=requestedMode==='beginner'?'beginner':requestedMode==='social'?'social':'pro'
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

  const beginnerSystem=[
    "You are RCXT Radar's beginner-friendly Solana market explainer.",
    'Analyze only the supplied token snapshot. Use plain language a brand-new trader can understand.',
    'Avoid unexplained jargon. If you use a term like liquidity, RSI, slippage, or market cap, explain it in a few words.',
    'Never claim certainty, guaranteed profit, a win probability, insider information, or exact future prices.',
    'The deterministic RCXT signal is the source of truth.',
    'Risk and direction are separate: a very young or thin-liquidity token can be extremely risky while momentum is still bullish.',
    'Never describe liquidity risk or pair age alone as proof price will fall. If liquidityReported is false, treat liquidity as unknown.',
    'When candle analytics are supplied, explain chart bias, RSI, support/resistance, volatility, and forecast ranges in plain language.',
    'When live trade tape is supplied, explain whether recent USD flow confirms or contradicts token-level buy/sell counts.',
    'Forecast ranges are scenario bands, not promised targets.',
    'Use exactly four short sections: BOTTOM LINE, WHY, WHAT COULD GO WRONG, BEGINNER NOTE.',
    'Explicitly say that score/confidence are not a probability of profit.',
    'Social evidence is lower trust and must never override contract, liquidity, or execution risk.'
  ].join('\n')

  const proSystem=[
    "You are RCXT Radar's market analyst. Analyze only the supplied Solana token snapshot.",
    'Be concise, skeptical, and practical. Never claim certainty, guaranteed profit, insider knowledge, or future prices.',
    'The deterministic RCXT signal is the source of truth. It separates directional opportunity/setup from execution risk, safety, and data quality.',
    'Risk is not the same as direction. If liquidityReported is false, explain that the liquidity field is unavailable rather than assuming zero.',
    'Social data is lower-trust supporting evidence because it can be manipulated. Never let social momentum override contract, liquidity, execution, or market-structure risk.',
    'Explain contradictions explicitly. A high social score with weak setup/execution is hype risk, not confirmation.',
    'Use supplied candle regime, support/resistance, forecast ranges, and live trade tape as additional evidence.',
    'If chart/trade-tape evidence conflicts with the RCXT signal, explicitly call that out and lower conviction.',
    'Forecast bands are volatility scenarios, not exact price predictions.',
    'Treat preliminary/unverified contract or concentration data as a limitation.',
    'Use exactly four short sections: SIGNAL, WHY, INVALIDATION, RISK.'
  ].join('\n')

  const socialSystem=[
    "You are RCXT Radar's X-feed intelligence analyst.",
    'Analyze only the supplied X search report and token identity. Do not browse, invent posts, or treat social claims as verified facts.',
    'Separate attention from quality: mention velocity can be high while the feed is duplicate-heavy, coordinated, low-quality, or negative.',
    'Use follower counts, verified status, engagement, duplicate ratio, author concentration, organic score, shill risk, acceleration, narratives, catalysts and repeated risk claims when present.',
    'Never call an account a bot with certainty. Say spam-like, coordinated-looking, duplicate-heavy, or low-quality when supported by the supplied metrics.',
    'Never claim a social post proves a catalyst, partnership, listing, stream, rug, scam, insider activity or other event. Label those as unverified X chatter unless corroborated in the supplied data.',
    'Do not turn social momentum into a profit prediction or buy/sell instruction.',
    'Use exactly four concise sections: X PULSE, WHAT X IS SAYING, QUALITY CHECK, WHAT TO WATCH.',
    'Mention sample size and acceleration when available, and explicitly flag weak sample sizes.'
  ].join('\n')

  const system=mode==='social'?socialSystem:mode==='beginner'?beginnerSystem:proSystem

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

  const analysis=mode==='social'?fallbackSocialAnalysis(scan,social):fallbackAnalysis(scan,social,mode)
  const fallbackModel=mode==='social'?'deterministic-x-social-v5':'deterministic-fallback-v4.2'
  await logAiAnalysis(
    {scan,model:fallbackModel,analysis,social},
    req.headers?.['x-vercel-oidc-token']
  )
  return res.status(200).json({
    success:true,
    model:fallbackModel,
    analysis,
    gatewayAvailable:false
  })
}
