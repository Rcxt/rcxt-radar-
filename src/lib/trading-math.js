export const CHALLENGE_MILESTONES=[
  5,10,25,50,100,250,500,1000,2500,5000,10000,25000,50000
]

function finite(value,fallback=0){
  const n=Number(value)
  return Number.isFinite(n)?n:fallback
}

export function projectedPositionValue({
  investment,
  entryMarketCap,
  targetMarketCap,
  estimatedCostsPercent=0,
}){
  const principal=Math.max(0,finite(investment))
  const entry=Math.max(0,finite(entryMarketCap))
  const target=Math.max(0,finite(targetMarketCap))
  const costs=Math.max(0,finite(estimatedCostsPercent))
  if(!principal||!entry||!target) return null

  const multiple=target/entry
  const grossValue=principal*multiple
  const grossProfit=grossValue-principal
  const estimatedCosts=grossValue*(costs/100)
  const netValue=Math.max(0,grossValue-estimatedCosts)
  const netProfit=netValue-principal

  return {
    multiple,
    grossValue,
    grossProfit,
    estimatedCosts,
    netValue,
    netProfit,
    roiPercent:(netProfit/principal)*100,
  }
}

export function buildProfitLadder({
  investment,
  entryMarketCap,
  estimatedCostsPercent=0,
  customTargets=[],
}){
  const entry=Math.max(0,finite(entryMarketCap))
  if(!entry) return []

  const canonical=[10000,20000,50000,100000,250000,500000,1000000,2500000,5000000,10000000]
  const multiples=[1.25,1.5,2,3,5,10].map((multiple)=>entry*multiple)
  const targets=[...canonical,...multiples,...customTargets.map(Number)]
    .filter((target)=>Number.isFinite(target)&&target>entry)
    .sort((a,b)=>a-b)

  const deduped=[]
  for(const target of targets){
    const rounded=target>=1_000_000?Math.round(target/10000)*10000:target>=100_000?Math.round(target/1000)*1000:Math.round(target/100)*100
    if(!deduped.length||Math.abs(rounded-deduped.at(-1))/rounded>0.025) deduped.push(rounded)
  }

  return deduped.slice(0,12)
    .map((targetMarketCap)=>{
      const projection=projectedPositionValue({investment,entryMarketCap:entry,targetMarketCap,estimatedCostsPercent})
      return projection ? { targetMarketCap, ...projection } : null
    })
    .filter(Boolean)
}

export function positionPlan({
  accountValue,
  riskPercent,
  stopDistancePercent,
}){
  const equity=Math.max(0,finite(accountValue))
  const riskPct=Math.max(0,finite(riskPercent))
  const stopPct=Math.max(0.1,finite(stopDistancePercent,10))
  const riskBudget=equity*(riskPct/100)
  const positionSize=Math.min(equity,riskBudget/(stopPct/100))
  return {
    riskBudget,
    positionSize,
    positionPercent:equity>0?(positionSize/equity)*100:0,
    stopDistancePercent:stopPct,
  }
}

export function challengeStats(currentValue,history=[]){
  const current=Math.max(0,finite(currentValue))
  const start=5
  const goal=50000
  const values=(history||[]).map((row)=>finite(row?.totalValueUsd)).filter((value)=>value>=0)
  if(current>0) values.push(current)
  const highWater=values.length?Math.max(...values):current
  const nextMilestone=CHALLENGE_MILESTONES.find((value)=>value>current)||goal
  const previous=[...CHALLENGE_MILESTONES].reverse().find((value)=>value<=current)||start
  const logStart=Math.log10(start)
  const logGoal=Math.log10(goal)
  const logCurrent=Math.log10(Math.max(start,current||start))
  const progress=Math.max(0,Math.min(100,((logCurrent-logStart)/(logGoal-logStart))*100))

  return {
    start,
    goal,
    current,
    multiple:current/start,
    progress,
    nextMilestone,
    previousMilestone:previous,
    toNext:Math.max(0,nextMilestone-current),
    percentToNext:current>0?((nextMilestone/current)-1)*100:null,
    remainingToGoal:Math.max(0,goal-current),
    requiredMultiple:current>0?goal/current:null,
    highWater,
    drawdownPercent:highWater>0?((current/highWater)-1)*100:0,
  }
}

export function beginnerMarketExplanation(scan,chartAnalytics){
  if(!scan) return []
  const intel=scan.intelligence||{}
  const analytics=chartAnalytics?.available?chartAnalytics:null
  const lines=[]

  lines.push({
    title:'What RCXT thinks',
    text:`${intel.signal||'WATCH'} with a ${intel.score??0}/100 risk-adjusted score. This means the setup has ${Number(intel.score||0)>=70?'several constructive signals':'meaningful weaknesses or missing confirmation'}; it does not mean a ${intel.score??0}% chance of profit.`,
  })

  const liquidity=Number(scan.market?.liquidityUsd||0)
  lines.push({
    title:'Can you get in and out?',
    text:liquidity>=50000
      ? `Liquidity is about $${Math.round(liquidity).toLocaleString()}, which is healthier than a thin launch, but slippage can still change quickly.`
      : `Liquidity is only about $${Math.round(liquidity).toLocaleString()}. Small liquidity makes entries/exits more sensitive to slippage and large sellers.`,
  })

  if(analytics){
    lines.push({
      title:'What the chart says',
      text:`The candle model is ${analytics.trend.toLowerCase()} with RSI ${analytics.indicators?.rsi14??'—'} and about ${analytics.indicators?.atrPercent??'—'}% average true range per candle. Model confidence is ${analytics.modelConfidence}% based on data agreement—not a win probability.`,
    })
  }

  const flags=intel.riskFlags||[]
  lines.push({
    title:'Biggest thing to watch',
    text:flags.length
      ? `Current warning: ${String(flags[0]).replaceAll('_',' ').toLowerCase()}. If that worsens, the setup can invalidate quickly.`
      : 'No single critical market flag dominates right now, but contract checks, liquidity, and seller pressure can change fast.',
  })

  return lines
}


export function requiredMarketCapForValue({
  investment,
  entryMarketCap,
  targetPositionValue,
  estimatedCostsPercent=0,
}){
  const principal=Math.max(0,finite(investment))
  const entry=Math.max(0,finite(entryMarketCap))
  const targetValue=Math.max(0,finite(targetPositionValue))
  const costs=Math.max(0,Math.min(95,finite(estimatedCostsPercent)))
  if(!principal||!entry||!targetValue) return null

  const retention=Math.max(0.01,1-costs/100)
  const grossNeeded=targetValue/retention
  const multiple=grossNeeded/principal
  const requiredMarketCap=entry*multiple
  return {
    requiredMarketCap,
    multiple,
    grossNeeded,
    targetPositionValue:targetValue,
  }
}

export function breakEvenMarketCap({
  investment,
  entryMarketCap,
  estimatedCostsPercent=0,
}){
  const principal=Math.max(0,finite(investment))
  const entry=Math.max(0,finite(entryMarketCap))
  const costs=Math.max(0,Math.min(95,finite(estimatedCostsPercent)))
  if(!principal||!entry) return null
  const retention=Math.max(0.01,1-costs/100)
  const multiple=1/retention
  return {
    multiple,
    marketCap:entry*multiple,
  }
}

export function buildExecutionChecklist({scan,analytics,tape,positionSize=0}){
  if(!scan) return []
  const intel=scan.intelligence||{}
  const liquidity=Number(scan.market?.liquidityUsd||0)
  const burden=liquidity>0&&Number(positionSize)>0 ? Number(positionSize)/liquidity*100 : null
  const chartAvailable=Boolean(analytics?.available)

  const items=[
    {
      key:'contract',
      label:'Contract controls',
      pass:Boolean(intel.contractVerified),
      unknown:!scan.security?.available,
      detail:intel.contractVerified?'Mint/freeze controls passed':'Contract verification incomplete or needs review',
    },
    {
      key:'liquidity',
      label:'Exit liquidity',
      pass:liquidity>=15000,
      unknown:!liquidity,
      detail:liquidity?('$'+Math.round(liquidity).toLocaleString()+' reported liquidity'):'Liquidity unavailable',
    },
    {
      key:'setup',
      label:'RCXT setup quality',
      pass:Number(intel.setupScore||0)>=60,
      unknown:intel.setupScore==null,
      detail:'Setup '+(intel.setupScore??'—')+'/100',
    },
    {
      key:'chart',
      label:'Chart structure',
      pass:chartAvailable&&['BULLISH','MIXED'].includes(analytics.trend)&&analytics.regime?.structure!=='DOWNTREND',
      unknown:!chartAvailable,
      detail:chartAvailable?(analytics.trend+' · '+(analytics.regime?.structure||'unknown')):'Waiting for candles',
    },
    {
      key:'flow',
      label:'Recent USD flow',
      pass:Number(tape?.netFlowUsd||0)>=0&&Number(tape?.buyVolumePercent||0)>=48,
      unknown:!tape,
      detail:tape?('$'+Math.round(Number(tape.netFlowUsd||0)).toLocaleString()+' net · '+Number(tape.buyVolumePercent||0).toFixed(1)+'% buy volume'):'Waiting for trade tape',
    },
    {
      key:'chase',
      label:'Not excessively extended',
      pass:chartAvailable?Number(analytics.momentum?.m15||0)<25:Number(scan.market?.priceChange?.m5||0)<20,
      unknown:false,
      detail:chartAvailable?('15m '+Number(analytics.momentum?.m15||0).toFixed(1)+'%'):('5m '+Number(scan.market?.priceChange?.m5||0).toFixed(1)+'%'),
    },
    {
      key:'burden',
      label:'Position vs liquidity',
      pass:burden==null?true:burden<=1,
      unknown:burden==null,
      detail:burden==null?'Enter account/risk settings to measure':'Planned position is '+burden.toFixed(2)+'% of liquidity',
    },
  ]

  const known=items.filter(item=>!item.unknown)
  return {
    items,
    passCount:known.filter(item=>item.pass).length,
    knownCount:known.length,
    readinessPercent:known.length?Math.round(known.filter(item=>item.pass).length/known.length*100):0,
  }
}


export function buildEntryQuality({scan,analytics,tape}){
  if(!scan) return {available:false,score:null,label:'UNAVAILABLE',reasons:[],warnings:[]}

  const reasons=[]
  const warnings=[]
  let score=50
  let evidence=0

  const liquidity=Number(scan?.market?.liquidityUsd||0)
  if(liquidity>0){
    evidence+=1
    if(liquidity>=50000){score+=12;reasons.push('Liquidity is relatively healthy')}
    else if(liquidity>=15000){score+=6;reasons.push('Liquidity is usable but still needs care')}
    else if(liquidity<5000){score-=18;warnings.push('Liquidity is very thin')}
    else {score-=6;warnings.push('Liquidity is below the preferred range')}
  }

  if(analytics?.available){
    evidence+=1
    const rr=Number(analytics?.levels?.structureRiskReward||0)
    const supportDistance=Number(analytics?.levels?.downsideToSupportPercent)
    const resistanceDistance=Number(analytics?.levels?.upsideToResistancePercent)
    const vwapDistance=Number(analytics?.indicators?.vwapDistancePercent)
    const m15=Number(analytics?.momentum?.m15||0)
    const atrPct=Number(analytics?.indicators?.atrPercent||0)

    if(rr>=2){score+=14;reasons.push('Nearest structure offers at least 2:1 upside-to-support geometry')}
    else if(rr>=1.2){score+=7;reasons.push('Nearest structure has positive risk/reward geometry')}
    else if(rr>0&&rr<0.8){score-=10;warnings.push('Nearby resistance is close relative to support')}

    if(Number.isFinite(supportDistance)){
      if(supportDistance>=-12&&supportDistance<0){score+=8;reasons.push('Price is relatively close to nearby support')}
      if(supportDistance<-25){score-=8;warnings.push('Nearest support is far below current price')}
    }

    if(Number.isFinite(resistanceDistance)&&resistanceDistance>20){
      score+=5
      reasons.push('There is room before the nearest resistance zone')
    }

    if(Number.isFinite(vwapDistance)){
      if(vwapDistance>=-4&&vwapDistance<=8){score+=6;reasons.push('Price is near recent volume-weighted value')}
      if(vwapDistance>18){score-=10;warnings.push('Price is stretched well above recent volume-weighted value')}
      if(vwapDistance<-10){score-=8;warnings.push('Price is trading well below recent volume-weighted value')}
    }

    if(m15>25){score-=12;warnings.push('15m move is extended and vulnerable to chasing')}
    if(m15<-20){score-=8;warnings.push('15m momentum is sharply negative')}
    if(atrPct>=18){score-=8;warnings.push('Per-candle volatility is extreme')}
  }

  if(tape){
    evidence+=1
    const net=Number(tape?.netFlowUsd||0)
    const buyPct=Number(tape?.buyVolumePercent||50)
    const flags=tape?.flags||[]

    if(net>0&&buyPct>=55){score+=8;reasons.push('Recent USD trade flow favors buyers')}
    if(net<0&&buyPct<=45){score-=10;warnings.push('Recent USD trade flow favors sellers')}
    if(flags.includes('MICROTRADE_NOISE')){score-=6;warnings.push('Trade activity contains heavy micro-trade noise')}
    if(flags.includes('REPEAT_WALLET_CHURN')){score-=7;warnings.push('Repeated-wallet churn reduces flow quality')}
    if(flags.includes('WALLET_VOLUME_CONCENTRATION')){score-=7;warnings.push('Recent USD volume is concentrated in one wallet')}
    if(flags.includes('MULTI_WHALE_ACCUMULATION')){score+=6;reasons.push('Multiple large sampled wallets show net accumulation')}
    if(flags.includes('MULTI_WHALE_DISTRIBUTION')){score-=12;warnings.push('Multiple large sampled wallets show net distribution')}
    if(flags.includes('WHALE_FLOW_CONCENTRATED')){score-=8;warnings.push('Whale-sized flow is concentrated in too few wallets')}
  }

  const risk=String(scan?.intelligence?.risk||'')
  if(risk==='EXTREME'){score=Math.min(score,45);warnings.push('RCXT structural risk is EXTREME')}
  else if(risk==='HIGH'){score=Math.min(score,62)}

  score=Math.max(0,Math.min(100,Math.round(score)))
  const label=
    score>=78?'FAVORABLE' :
    score>=62?'DECENT' :
    score>=45?'MIXED' :
    score>=30?'POOR' : 'AVOID CHASING'

  return {
    available:evidence>=2,
    score,
    label,
    evidenceCount:evidence,
    reasons:reasons.slice(0,4),
    warnings:warnings.slice(0,4),
    meaning:'Entry-context quality, not a probability of profit or a trade recommendation.',
  }
}


export function buildRugRiskChecklist({scan,tape}){
  if(!scan) return {available:false,items:[],critical:0,warning:0,unknown:0,label:'UNAVAILABLE'}

  const intel=scan.intelligence||{}
  const security=scan.security||{}
  const market=scan.market||{}
  const trading=scan.trading||{}
  const concentration=intel.concentration||{}
  const tapeFlags=tape?.flags||[]
  const items=[]

  function add(key,label,severity,detail,source='computed'){
    items.push({key,label,severity,detail,source})
  }

  if(!security.available){
    add('contract-data','Contract data','unknown','Mint security data is unavailable or incomplete.','measured')
  }else{
    add(
      'mint-authority',
      'Mint authority',
      security.mintAuthority?'critical':'pass',
      security.mintAuthority?'Mint authority is still active.':'Mint authority is disabled.',
      'measured'
    )
    add(
      'freeze-authority',
      'Freeze authority',
      security.freezeAuthority?'critical':'pass',
      security.freezeAuthority?'Freeze authority is still active.':'Freeze authority is disabled.',
      'measured'
    )
  }

  if(concentration.available){
    const top1=Number(concentration.top1Percent||0)
    const top10=Number(concentration.top10Percent||0)
    const method=concentration.method==='RESOLVED_TOKEN_ACCOUNT_OWNERS'?'resolved owners':'token accounts'
    add(
      'concentration',
      'Supply concentration',
      top1>=70||top10>=92?'critical':top1>=45||top10>=80?'warning':'pass',
      `Top 1 ${method}: ${top1.toFixed(1)}% · Top 10: ${top10.toFixed(1)}%.`,
      'measured'
    )
  }else{
    add('concentration','Supply concentration','unknown','Largest holder/account concentration could not be verified.','measured')
  }

  const liquidityReported=intel.liquidityReported!==false
  const liquidity=liquidityReported?Number(market.liquidityUsd||0):null
  const liquidityToCap=liquidityReported&&intel.liquidityToCapPercent!=null
    ? Number(intel.liquidityToCapPercent)
    : null

  if(!liquidityReported){
    add(
      'liquidity',
      'Exit liquidity',
      'unknown',
      intel.liquiditySource==='PUMPFUN_BONDING_CURVE_UNREPORTED'
        ? 'Pump.fun bonding-curve liquidity is not reported as AMM pool liquidity.'
        : 'Liquidity data is unavailable.',
      'measured'
    )
    add(
      'liq-cap',
      'Liquidity vs market cap',
      'unknown',
      'Cannot compute a liquidity-to-market-cap ratio without a reported liquidity value.',
      'computed'
    )
  }else{
    add(
      'liquidity',
      'Exit liquidity',
      liquidity<3000?'critical':liquidity<10000?'warning':'pass',
      liquidity?`Reported pool liquidity is about ${Math.round(liquidity).toLocaleString()}.`:'Reported liquidity is zero.',
      'measured'
    )
    add(
      'liq-cap',
      'Liquidity vs market cap',
      liquidityToCap>0&&liquidityToCap<2?'critical':liquidityToCap<6?'warning':'pass',
      `Liquidity is ${Number(liquidityToCap||0).toFixed(1)}% of market cap.`,
      'computed'
    )
  }

  const ageHours=Number(intel.ageHours)
  if(Number.isFinite(ageHours)){
    add(
      'age',
      'Pair maturity',
      ageHours<0.25?'critical':ageHours<2?'warning':'pass',
      ageHours<1?`Pair is about ${Math.round(ageHours*60)} minutes old.`:`Pair is about ${ageHours.toFixed(1)} hours old.`,
      'measured'
    )
  }else{
    add('age','Pair maturity','unknown','Pair creation time is unavailable.','measured')
  }

  if(intel.turnover24h==null){
    add(
      'turnover',
      'Turnover / churn',
      'unknown',
      'Turnover cannot be calculated without a reported liquidity value.',
      'computed'
    )
  }else{
    const turnover=Number(intel.turnover24h||0)
    add(
      'turnover',
      'Turnover / churn',
      turnover>=150?'warning':turnover>=60?'watch':'pass',
      `24h volume is about ${turnover.toFixed(1)}× reported liquidity.`,
      'computed'
    )
  }

  const buy1=Number(intel.buyPercent1h||50)
  add(
    'seller-pressure',
    'Recent order flow',
    buy1<30?'critical':buy1<42?'warning':buy1>85?'watch':'pass',
    `1h transaction count is ${buy1.toFixed(1)}% buys.`,
    'measured'
  )

  const h1=Number(market?.priceChange?.h1||0)
  const h24=Number(market?.priceChange?.h24||0)
  add(
    'price-structure',
    'Price stretch',
    h1>150||h24>1000?'warning':h1<-40?'critical':h1>60||h24>400?'watch':'pass',
    `Price change: 1h ${h1>=0?'+':''}${h1.toFixed(1)}% · 24h ${h24>=0?'+':''}${h24.toFixed(1)}%.`,
    'measured'
  )

  if(tape){
    const manipulationFlags=[
      'MICROTRADE_NOISE',
      'REPEAT_WALLET_CHURN',
      'WALLET_ACTIVITY_CONCENTRATION',
      'WALLET_VOLUME_CONCENTRATION',
      'TRADE_SIZE_SKEW',
      'WHALE_FLOW_CONCENTRATED',
      'MULTI_WHALE_DISTRIBUTION',
    ].filter(flag=>tapeFlags.includes(flag))

    add(
      'trade-quality',
      'Recent trade quality',
      manipulationFlags.length>=3?'critical':manipulationFlags.length?'warning':'pass',
      manipulationFlags.length
        ? manipulationFlags.map(flag=>flag.replaceAll('_',' ').toLowerCase()).join(' · ')
        : 'No major recent tape-quality anomaly was detected in the sampled trades.',
      'measured'
    )
  }else{
    add('trade-quality','Recent trade quality','unknown','Recent trade tape is not available.','measured')
  }

  const critical=items.filter(item=>item.severity==='critical').length
  const warning=items.filter(item=>item.severity==='warning').length
  const watch=items.filter(item=>item.severity==='watch').length
  const unknown=items.filter(item=>item.severity==='unknown').length

  const label=
    critical>=2?'SEVERE RED FLAGS':
    critical===1?'CRITICAL FLAG':
    warning>=3?'HIGH CAUTION':
    warning>=1||watch>=2?'CAUTION':
    unknown>=3?'INCOMPLETE DATA':'NO MAJOR FLAGS'

  return {
    available:true,
    items,
    critical,
    warning,
    watch,
    unknown,
    label,
    meaning:'Evidence checklist for structural/manipulation risk. It cannot prove a token is or is not a scam.',
  }
}
