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

  return deduped.slice(0,12).map((targetMarketCap)=>({
    targetMarketCap,
    ...projectedPositionValue({investment,entryMarketCap:entry,targetMarketCap,estimatedCostsPercent}),
  }))
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
