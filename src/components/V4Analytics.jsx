'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  beginnerMarketExplanation,
  breakEvenMarketCap,
  buildEntryQuality,
  buildRugRiskChecklist,
  buildExecutionChecklist,
  buildProfitLadder,
  positionPlan,
  projectedPositionValue,
  requiredMarketCapForValue,
} from '../lib/trading-math.js'

function money(value){
  const n=Number(value)
  if(!Number.isFinite(n)) return '—'
  if(Math.abs(n)>=1000000) return '$'+(n/1000000).toFixed(n>=10000000?1:2)+'M'
  if(Math.abs(n)>=1000) return '$'+(n/1000).toFixed(n>=100000?0:1)+'K'
  return n.toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:n<10?2:0})
}

function tiny(value){
  const n=Number(value)
  if(!Number.isFinite(n)||n<=0) return '—'
  if(n>=1) return '$'+n.toFixed(4)
  if(n>=0.01) return '$'+n.toFixed(6)
  return '$'+n.toPrecision(5)
}

function pct(value,digits=1){
  const n=Number(value)
  return Number.isFinite(n)?(n>=0?'+':'')+n.toFixed(digits)+'%':'—'
}

function CandleChart({candles}){
  const data=(candles||[]).slice(-72)
  if(data.length<2) return <div className="v4ChartEmpty">Not enough candle history yet.</div>
  const width=900,height=310,top=16,bottom=28,left=12,right=12
  const max=Math.max(...data.map(c=>c.high))
  const min=Math.min(...data.map(c=>c.low))
  const range=Math.max(max-min,max*0.001)
  const plotHeight=height-top-bottom
  const plotWidth=width-left-right
  const step=plotWidth/data.length
  const bodyWidth=Math.max(2,Math.min(8,step*0.58))
  const y=(value)=>top+((max-value)/range)*plotHeight

  return (
    <div className="v4ChartWrap">
      <svg className="v4Chart" viewBox={'0 0 '+width+' '+height} role="img" aria-label="OHLCV candlestick chart">
        {[0,.25,.5,.75,1].map(fraction=>(
          <line key={fraction} x1={left} x2={width-right} y1={top+plotHeight*fraction} y2={top+plotHeight*fraction} className="chartGridLine" />
        ))}
        {data.map((candle,index)=>{
          const x=left+index*step+step/2
          const up=candle.close>=candle.open
          const bodyTop=y(Math.max(candle.open,candle.close))
          const bodyBottom=y(Math.min(candle.open,candle.close))
          return (
            <g key={candle.timestamp} className={up?'candle up':'candle down'}>
              <line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} />
              <rect x={x-bodyWidth/2} y={bodyTop} width={bodyWidth} height={Math.max(1.5,bodyBottom-bodyTop)} rx="1" />
            </g>
          )
        })}
        <text x={left} y={height-8}>{new Date(data[0].timestamp*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</text>
        <text x={width-right} y={height-8} textAnchor="end">{new Date(data.at(-1).timestamp*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</text>
      </svg>
      <div className="chartPriceScale"><span>{tiny(max)}</span><span>{tiny((max+min)/2)}</span><span>{tiny(min)}</span></div>
    </div>
  )
}

function ForecastCard({label,forecast}){
  if(!forecast) return null
  return (
    <div className="forecastCard">
      <span>{label}</span>
      <div className="forecastRange">
        <div className="bear"><small>Bear</small><b>{tiny(forecast.bearPrice)}</b><em>{pct(forecast.bearPercent)}</em></div>
        <div className="base"><small>Base</small><b>{tiny(forecast.basePrice)}</b><em>{pct(forecast.basePercent)}</em></div>
        <div className="bull"><small>Bull</small><b>{tiny(forecast.bullPrice)}</b><em>{pct(forecast.bullPercent)}</em></div>
      </div>
      <small className="forecastMove">Volatility band ≈ ±{forecast.expectedMovePercent}%</small>
    </div>
  )
}

export default function V4AnalyticsSuite({scan,walletEquity=0,onContext}){
  const [interval,setIntervalValue]=useState('5m')
  const [chart,setChart]=useState(null)
  const [tape,setTape]=useState(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [investment,setInvestment]=useState('20')
  const [entryMarketCap,setEntryMarketCap]=useState('')
  const [customTarget,setCustomTarget]=useState('')
  const [estimatedCosts,setEstimatedCosts]=useState('0')
  const [riskPercent,setRiskPercent]=useState('1')
  const [stopDistance,setStopDistance]=useState('15')
  const [accountValue,setAccountValue]=useState(walletEquity?String(walletEquity):'')
  const [targetPositionValue,setTargetPositionValue]=useState('100')
  const [takeProfitPercent,setTakeProfitPercent]=useState('50')
  const [scaleOutPercent,setScaleOutPercent]=useState('25')
  const [planThesis,setPlanThesis]=useState('')
  const [planInvalidation,setPlanInvalidation]=useState('')
  const [planSavedAt,setPlanSavedAt]=useState(null)
  const [planAlerts,setPlanAlerts]=useState(false)
  const [planStatus,setPlanStatus]=useState('DRAFT')
  const [planEnteredAt,setPlanEnteredAt]=useState(null)
  const [planClosedAt,setPlanClosedAt]=useState(null)
  const [planExitMarketCap,setPlanExitMarketCap]=useState(null)
  const [planExitValue,setPlanExitValue]=useState(null)
  const [planExitPnl,setPlanExitPnl]=useState(null)
  const planZoneRef=useRef(null)

  useEffect(()=>{
    setEntryMarketCap(scan?.market?.marketCap?String(Math.round(scan.market.marketCap)):'')
    if(!scan?.address) return
    try{
      const saved=JSON.parse(localStorage.getItem('rcxt-trade-plan:'+scan.address)||'null')
      if(saved){
        if(saved.investment!=null) setInvestment(String(saved.investment))
        if(saved.entryMarketCap!=null) setEntryMarketCap(String(saved.entryMarketCap))
        if(saved.takeProfitPercent!=null) setTakeProfitPercent(String(saved.takeProfitPercent))
        if(saved.scaleOutPercent!=null) setScaleOutPercent(String(saved.scaleOutPercent))
        if(saved.stopDistance!=null) setStopDistance(String(saved.stopDistance))
        setPlanThesis(saved.thesis||'')
        setPlanInvalidation(saved.invalidation||'')
        setPlanSavedAt(saved.savedAt||null)
        setPlanAlerts(Boolean(saved.planAlerts))
        setPlanStatus(saved.status||'DRAFT')
        setPlanEnteredAt(saved.enteredAt||null)
        setPlanClosedAt(saved.closedAt||null)
        setPlanExitMarketCap(saved.exitMarketCap??null)
        setPlanExitValue(saved.exitValue??null)
        setPlanExitPnl(saved.exitPnl??null)
      }else{
        setPlanThesis('')
        setPlanInvalidation('')
        setPlanSavedAt(null)
        setPlanAlerts(false)
        setPlanStatus('DRAFT')
        setPlanEnteredAt(null)
        setPlanClosedAt(null)
        setPlanExitMarketCap(null)
        setPlanExitValue(null)
        setPlanExitPnl(null)
      }
    }catch{}
  },[scan?.address])

  useEffect(()=>{
    if(walletEquity>0) setAccountValue(String(Number(walletEquity).toFixed(2)))
  },[walletEquity])

  useEffect(()=>{
    const pairAge=Number(scan?.intelligence?.ageHours)
    if(scan?.address&&Number.isFinite(pairAge)&&pairAge<0.75){
      setIntervalValue('1m')
    }
  },[scan?.address])

  useEffect(()=>{
    let active=true
    const pair=scan?.pair?.pairAddress
    if(!pair){setChart(null);return}
    async function load(){
      setLoading(true);setError('')
      try{
        const response=await fetch('/api/chart?pair='+encodeURIComponent(pair)+'&interval='+encodeURIComponent(interval),{cache:'no-store'})
        const data=await response.json()
        if(!response.ok||!data?.success) throw new Error(data?.error||'Chart unavailable')
        if(active) setChart(data)
      }catch(err){
        if(active){setError(err.message);setChart(null)}
      }finally{if(active)setLoading(false)}
    }
    load()
    const timer=setInterval(load,30000)
    return()=>{active=false;clearInterval(timer)}
  },[scan?.pair?.pairAddress,interval])

  useEffect(()=>{
    let active=true
    const pair=scan?.pair?.pairAddress
    if(!pair){setTape(null);return}

    async function loadTape(){
      try{
        const response=await fetch('/api/trades?pair='+encodeURIComponent(pair),{cache:'no-store'})
        const data=await response.json()
        if(response.ok&&data?.success&&active) setTape(data)
      }catch{}
    }

    loadTape()
    const timer=setInterval(loadTape,30000)
    return()=>{active=false;clearInterval(timer)}
  },[scan?.pair?.pairAddress])

  const ladder=useMemo(()=>buildProfitLadder({
    investment,
    entryMarketCap,
    estimatedCostsPercent:estimatedCosts,
    customTargets:customTarget?[customTarget]:[],
  }),[investment,entryMarketCap,estimatedCosts,customTarget])

  const customProjection=useMemo(()=>projectedPositionValue({
    investment,
    entryMarketCap,
    targetMarketCap:customTarget,
    estimatedCostsPercent:estimatedCosts,
  }),[investment,entryMarketCap,customTarget,estimatedCosts])

  const riskPlan=useMemo(()=>positionPlan({
    accountValue,
    riskPercent,
    stopDistancePercent:stopDistance,
  }),[accountValue,riskPercent,stopDistance])

  const beginner=useMemo(()=>beginnerMarketExplanation(scan,chart?.analytics),[scan,chart?.analytics])
  const analytics=chart?.analytics
  const candleCount=Array.isArray(chart?.candles)?chart.candles.length:0
  const pairAgeHours=Number(scan?.intelligence?.ageHours)
  const limitedHistory=Boolean(
    chart && (
      (Number.isFinite(pairAgeHours) && pairAgeHours < 1) ||
      candleCount < 10
    )
  )

  const marketCapMap=useMemo(()=>{
    const fallback=scan?.intelligence?.marketCapPlan || {}
    const current=Number(scan?.market?.marketCap || fallback.current || 0)
    const price=Number(scan?.market?.priceUsd || 0)
    const structuralVeto=Boolean(
      fallback?.available &&
      fallback?.entryLow == null &&
      String(fallback?.action || '').startsWith('NO ENTRY')
    )
    const toMc=(level)=>{
      const value=Number(level)
      if(!(current>0)||!(price>0)||!(value>0)) return null
      return Math.round(current*(value/price))
    }
    const supports=(analytics?.levels?.support||[])
      .map(toMc)
      .filter((value)=>Number.isFinite(value)&&value>0&&value<current)
      .sort((a,b)=>a-b)
    const resistances=(analytics?.levels?.resistance||[])
      .map(toMc)
      .filter((value)=>Number.isFinite(value)&&value>current)
      .sort((a,b)=>a-b)

    const entryHigh=structuralVeto ? null : (supports.at(-1) ?? fallback.entryHigh ?? null)
    const entryLow=structuralVeto ? null : (supports.at(-2) ?? fallback.entryLow ?? entryHigh)
    const breakout=structuralVeto ? null : (resistances[0] ?? fallback.breakout ?? null)
    const trim1=structuralVeto ? null : (resistances[1] ?? resistances[0] ?? fallback.trim1 ?? null)
    const target2=structuralVeto ? null : (resistances[2] ?? fallback.target2 ?? null)
    const stretch=structuralVeto ? null : (fallback.stretch ?? null)
    const invalidation=supports.length
      ? Math.round(supports[0]*0.97)
      : Number(fallback.invalidation || 0) || null
    const chartBased=supports.length>0||resistances.length>0

    return {
      available:current>0,
      current,
      action:fallback.action || 'SCENARIO MAP',
      entryLow,
      entryHigh,
      breakout,
      trim1,
      target2,
      stretch,
      invalidation,
      basis:chartBased
        ? 'Chart support/resistance converted into market-cap levels'
        : 'Recent volatility + risk scenario',
      chartBased,
      structuralVeto,
    }
  },[
    scan?.market?.marketCap,
    scan?.market?.priceUsd,
    scan?.intelligence?.marketCapPlan,
    analytics?.levels,
  ])

  const reverseTarget=useMemo(()=>requiredMarketCapForValue({
    investment,
    entryMarketCap,
    targetPositionValue,
    estimatedCostsPercent:estimatedCosts,
  }),[investment,entryMarketCap,targetPositionValue,estimatedCosts])

  const breakEven=useMemo(()=>breakEvenMarketCap({
    investment,
    entryMarketCap,
    estimatedCostsPercent:estimatedCosts,
  }),[investment,entryMarketCap,estimatedCosts])

  useEffect(()=>{
    if(typeof onContext!=='function') return
    onContext({
      chart: analytics?.available ? {
        trend: analytics.trend,
        bias: analytics.bias,
        modelConfidence: analytics.modelConfidence,
        dataQuality: analytics.dataQuality,
        indicators: analytics.indicators,
        momentum: analytics.momentum,
        levels: analytics.levels,
        regime: analytics.regime,
        forecast: analytics.forecast,
        reasons: analytics.reasons,
        risks: analytics.risks,
        marketCapMap,
      } : null,
      tape: tape?.summary || null,
    })
  },[analytics,tape?.summary,onContext,marketCapMap])

  const checklist=useMemo(()=>buildExecutionChecklist({
    scan,
    analytics,
    tape:tape?.summary,
    positionSize:riskPlan.positionSize,
  }),[scan,analytics,tape?.summary,riskPlan.positionSize])

  const entryQuality=useMemo(()=>buildEntryQuality({
    scan,
    analytics,
    tape:tape?.summary,
  }),[scan,analytics,tape?.summary])

  const rugGuard=useMemo(()=>buildRugRiskChecklist({
    scan,
    tape:tape?.summary,
  }),[scan,tape?.summary])

  const liquidityBurden=useMemo(()=>{
    const liquidity=Number(scan?.market?.liquidityUsd||0)
    if(!liquidity||!riskPlan.positionSize) return null
    const percent=riskPlan.positionSize/liquidity*100
    return {
      percent,
      label:percent<=0.25?'LOW':percent<=1?'MODERATE':percent<=3?'HIGH':'EXTREME',
    }
  },[riskPlan.positionSize,scan?.market?.liquidityUsd])

  const consensus=useMemo(()=>{
    if(!analytics?.available) return null
    const direction=String(scan?.intelligence?.directionalBias||'NEUTRAL')
    const coreBull=direction==='BULLISH'
    const coreBear=direction==='BEARISH'
    const chartBull=analytics.trend==='BULLISH'
    const chartBear=analytics.trend==='BEARISH'
    if((coreBull&&chartBull)||(coreBear&&chartBear)) return {label:'ALIGNED',tone:'good',text:'RCXT directional structure and candle model point in the same direction.'}
    if((coreBull&&chartBear)||(coreBear&&chartBull)) return {label:'CONFLICT',tone:'bad',text:'RCXT directional structure and candle model disagree. Treat direction as lower-conviction until they converge.'}
    return {label:'MIXED',tone:'mid',text:'At least one directional layer is neutral. Confirmation is incomplete.'}
  },[analytics?.available,analytics?.trend,scan?.intelligence?.directionalBias])

  const decisionSummary=useMemo(()=>{
    const score=Number(scan?.intelligence?.score||0)
    const signal=String(scan?.intelligence?.signal||'WATCH')
    const direction=String(scan?.intelligence?.directionalBias||'NEUTRAL')
    const opportunity=Number(scan?.intelligence?.opportunityScore??scan?.intelligence?.setupScore??0)
    const liquidityReported=scan?.intelligence?.liquidityReported!==false
    const chartTrend=analytics?.trend||'UNKNOWN'
    const tapeNet=Number(tape?.summary?.netFlowUsd||0)
    const tapeBuyPct=Number(tape?.summary?.buyVolumePercent||50)
    let strength=0
    const positives=[]
    const warnings=[]

    if(direction==='BULLISH'){strength+=2;positives.push('RCXT directional bias is bullish')}
    if(direction==='BEARISH'){strength-=2;warnings.push('RCXT directional bias is bearish')}
    if(opportunity>=70){strength+=1;positives.push('Opportunity / momentum score is strong')}
    if(signal==='SELL / AVOID'){strength-=2;warnings.push('Hard structural safety controls are failing')}
    else if(signal==='REDUCE'){strength-=1;warnings.push('Risk-adjusted setup is deteriorating')}
    if(score>=75){strength+=1;positives.push('Risk-adjusted tradability score is strong')}
    if(score<50){strength-=1;warnings.push('Risk-adjusted tradability score is weak')}
    if(chartTrend==='BULLISH'){strength+=1;positives.push('Candle structure is bullish')}
    if(chartTrend==='BEARISH'){strength-=1;warnings.push('Candle structure is bearish')}
    if(tapeNet>0&&tapeBuyPct>=55){strength+=1;positives.push('Recent USD flow favors buyers')}
    if(tapeNet<0&&tapeBuyPct<=45){strength-=1;warnings.push('Recent USD flow favors sellers')}
    const tapeFlags=tape?.summary?.flags||[]
    if(tapeFlags.includes('MICROTRADE_NOISE')){strength-=1;warnings.push('Recent activity is dominated by micro-trade noise')}
    if(tapeFlags.includes('REPEAT_WALLET_CHURN')){strength-=1;warnings.push('Repeated wallets dominate recent transaction activity')}
    if(tapeFlags.includes('WALLET_VOLUME_CONCENTRATION')){strength-=1;warnings.push('One wallet controls a large share of recent USD volume')}
    if(tapeFlags.includes('MULTI_WHALE_ACCUMULATION')){strength+=1;positives.push('Multiple large sampled wallets are net accumulating')}
    if(tapeFlags.includes('MULTI_WHALE_DISTRIBUTION')){strength-=2;warnings.push('Multiple large sampled wallets are net distributing')}
    if(tapeFlags.includes('WHALE_FLOW_CONCENTRATED')){strength-=1;warnings.push('Whale-sized flow is concentrated in very few wallets')}
    if(liquidityReported&&Number(scan?.market?.liquidityUsd||0)<5000){strength-=2;warnings.push('Reported liquidity is very thin')}
    if(!liquidityReported){warnings.push('Liquidity is unreported; execution depth is uncertain')}
    if(scan?.intelligence?.risk==='EXTREME'){strength-=2;warnings.push('RCXT structural / execution risk is extreme')}
    if(rugGuard?.critical>=2){strength-=2;warnings.push('Rug / Manipulation Guard has multiple critical flags')}
    else if(rugGuard?.critical===1){strength-=1;warnings.push('Rug / Manipulation Guard has a critical flag')}

    let label=strength>=4?'STRONG CONFLUENCE':strength>=2?'CONSTRUCTIVE':strength<=-3?'HIGH RISK':strength<=-1?'DEFENSIVE':'MIXED'
    if(direction==='BULLISH'&&['HIGH','EXTREME'].includes(scan?.intelligence?.risk)&&opportunity>=60){
      label='HOT / HIGH RISK'
    }
    return {label,strength,positives:positives.slice(0,4),warnings:warnings.slice(0,4)}
  },[scan?.intelligence?.score,scan?.intelligence?.signal,scan?.intelligence?.risk,scan?.intelligence?.directionalBias,scan?.intelligence?.opportunityScore,scan?.intelligence?.setupScore,scan?.intelligence?.liquidityReported,scan?.market?.liquidityUsd,analytics?.trend,tape?.summary?.netFlowUsd,tape?.summary?.buyVolumePercent,tape?.summary?.flags,rugGuard?.critical])

  const exitPlan=useMemo(()=>{
    const position=Math.max(0,Number(investment||0))
    const tp=Math.max(0,Number(takeProfitPercent||0))
    const scale=Math.max(0,Math.min(100,Number(scaleOutPercent||0)))
    const stop=Math.max(0,Number(stopDistance||0))
    const targetValue=position*(1+tp/100)
    const stopValue=position*(1-stop/100)
    const firstScaleValue=targetValue*(scale/100)
    const runnerValue=targetValue-firstScaleValue
    return {position,tp,scale,stop,targetValue,stopValue,firstScaleValue,runnerValue}
  },[investment,takeProfitPercent,scaleOutPercent,stopDistance])

  const livePosition=useMemo(()=>{
    const position=Math.max(0,Number(investment||0))
    const entry=Math.max(0,Number(entryMarketCap||0))
    const currentMc=Math.max(0,Number(scan?.market?.marketCap||0))
    const tp=Math.max(0,Number(takeProfitPercent||0))
    const stop=Math.max(0,Number(stopDistance||0))

    if(!position||!entry||!currentMc){
      return {available:false}
    }

    const current=projectedPositionValue({
      investment:position,
      entryMarketCap:entry,
      targetMarketCap:currentMc,
      estimatedCostsPercent:estimatedCosts,
    })
    const targetMc=entry*(1+tp/100)
    const stopMc=Math.max(0,entry*(1-stop/100))
    const movePercent=((currentMc/entry)-1)*100
    const targetDistancePercent=currentMc>0?((targetMc/currentMc)-1)*100:null
    const stopDistanceFromCurrent=currentMc>0?((stopMc/currentMc)-1)*100:null
    const remainingUpside=Math.max(0,targetMc-currentMc)
    const remainingDownside=Math.max(0,currentMc-stopMc)
    const remainingRiskReward=remainingDownside>0?remainingUpside/remainingDownside:null

    const status=
      currentMc>=targetMc?'TARGET ZONE':
      currentMc<=stopMc?'STOP / INVALIDATION ZONE':
      currentMc>entry?'IN PROFIT':
      currentMc<entry?'UNDER ENTRY':'AT ENTRY'

    return {
      available:true,
      current,
      entryMarketCap:entry,
      currentMarketCap:currentMc,
      targetMarketCap:targetMc,
      stopMarketCap:stopMc,
      movePercent,
      targetDistancePercent,
      stopDistanceFromCurrent,
      remainingRiskReward,
      status,
    }
  },[
    investment,
    entryMarketCap,
    scan?.market?.marketCap,
    takeProfitPercent,
    stopDistance,
    estimatedCosts,
  ])

  useEffect(()=>{
    if(!scan?.address){
      planZoneRef.current=null
      return
    }
    const next=livePosition?.available?livePosition.status:null
    const previous=planZoneRef.current
    planZoneRef.current=next

    if(!planAlerts||!planSavedAt||!next||next===previous) return
    if(next==='TARGET ZONE'){
      notifyPlan(
        'RCXT Trade Plan · Target Zone',
        (scan?.token?.symbol||'Token')+' reached the saved TP market-cap zone.'
      )
    }
    if(next==='STOP / INVALIDATION ZONE'){
      notifyPlan(
        'RCXT Trade Plan · Invalidation Zone',
        (scan?.token?.symbol||'Token')+' reached the saved stop/invalidation market-cap zone.'
      )
    }
  },[
    scan?.address,
    scan?.token?.symbol,
    livePosition?.status,
    livePosition?.available,
    planAlerts,
    planSavedAt,
  ])
  async function copyFullReport(){
    if(!scan) return
    const a=analytics
    const tapeSummary=tape?.summary
    const lines=[
      'RCXT V4 REPORT · '+(scan.token?.symbol||'TOKEN'),
      'Signal: '+(scan.intelligence?.signal||'WATCH')+' · Score '+(scan.intelligence?.score??'—')+'/100 · Risk '+(scan.intelligence?.risk||'—'),
      'Setup / Execution / Safety / Data: '+[
        scan.intelligence?.setupScore,
        scan.intelligence?.executionScore,
        scan.intelligence?.safetyScore,
        scan.intelligence?.dataQualityScore,
      ].map(v=>v??'—').join(' / '),
      a?.available?'Chart: '+a.trend+' · '+(a.regime?.structure||'—')+' / '+(a.regime?.phase||'—')+' · RSI '+(a.indicators?.rsi14??'—')+' · ATR '+(a.indicators?.atrPercent??'—')+'% · VWAP '+(a.indicators?.vwapDistancePercent??'—')+'%':'Chart: unavailable',
      entryQuality?.available?'Entry Quality: '+entryQuality.score+'/100 '+entryQuality.label:'Entry Quality: unavailable',
      a?.available?'Support '+tiny(a.levels?.nearestSupport)+' · Resistance '+tiny(a.levels?.nearestResistance)+' · Structure R:R '+(a.levels?.structureRiskReward??'—')+'x':'',
      tapeSummary?'Trade tape: '+money(tapeSummary.netFlowUsd)+' net flow · '+tapeSummary.buyVolumePercent+'% buy volume · '+tapeSummary.uniqueWallets+' wallets · whale net '+money(tapeSummary.whaleWalletNetFlowUsd):'Trade tape: unavailable',
      scan?.security?.topOwners?.length?'Supply whales: '+scan.security.supplyWhaleCount+' owner wallets ≥5% · top owner '+Number(scan.security.topOwners[0]?.supplyPercent||0).toFixed(2)+'%':'Supply whales: unavailable',
      checklist?.knownCount?'Checklist: '+checklist.passCount+'/'+checklist.knownCount+' checks passing ('+checklist.readinessPercent+'%)':'Checklist: unavailable',
      'Liquidity: '+money(scan.market?.liquidityUsd)+' · Market cap: '+money(scan.market?.marketCap),
      'Risk flags: '+((scan.intelligence?.riskFlags||[]).join(', ')||'none'),
      'Forecast bands are scenarios, not guaranteed targets.',
    ].filter(Boolean)
    try{await navigator.clipboard.writeText(lines.join('\n'))}catch{}
  }

  async function notifyPlan(title,body){
    if(typeof window==='undefined'||typeof Notification==='undefined') return
    if(Notification.permission!=='granted') return

    try{
      if('serviceWorker' in navigator){
        const registration=await navigator.serviceWorker.ready
        await registration.showNotification(title,{
          body,
          tag:'rcxt-plan-'+scan?.address,
          renotify:true,
          data:{url:'/?token='+encodeURIComponent(scan?.address||'')},
        })
        return
      }
      new Notification(title,{body,tag:'rcxt-plan-'+scan?.address})
    }catch{}
  }

  async function togglePlanAlerts(){
    let next=!planAlerts
    if(next && typeof Notification!=='undefined' && Notification.permission!=='granted'){
      try{
        const permission=await Notification.requestPermission()
        next=permission==='granted'
      }catch{
        next=false
      }
    }
    setPlanAlerts(next)

    if(scan?.address){
      try{
        const key='rcxt-trade-plan:'+scan.address
        const existing=JSON.parse(localStorage.getItem(key)||'null')
        if(existing){
          localStorage.setItem(key,JSON.stringify({...existing,planAlerts:next}))
        }
      }catch{}
    }
  }

  function planPayload(overrides={}){
    return {
      token:scan?.token?.symbol||'TOKEN',
      name:scan?.token?.name||'',
      address:scan?.address||'',
      investment:Number(investment||0),
      entryMarketCap:Number(entryMarketCap||0),
      takeProfitPercent:Number(takeProfitPercent||0),
      scaleOutPercent:Number(scaleOutPercent||0),
      stopDistance:Number(stopDistance||0),
      thesis:planThesis,
      invalidation:planInvalidation,
      planAlerts,
      status:planStatus,
      enteredAt:planEnteredAt,
      closedAt:planClosedAt,
      exitMarketCap:planExitMarketCap,
      exitValue:planExitValue,
      exitPnl:planExitPnl,
      savedAt:Date.now(),
      ...overrides,
    }
  }

  function persistTradePlan(overrides={}){
    if(!scan?.address) return null
    const payload=planPayload(overrides)
    try{
      localStorage.setItem('rcxt-trade-plan:'+scan.address,JSON.stringify(payload))
      setPlanSavedAt(payload.savedAt)
      window.dispatchEvent(new CustomEvent('rcxt-trade-plan-updated',{detail:payload}))
      return payload
    }catch{
      return null
    }
  }

  function saveTradePlan(){
    persistTradePlan()
  }

  function markPlanEntered(){
    if(!scan?.address||!Number(investment||0)||!Number(entryMarketCap||0)) return
    const enteredAt=Date.now()
    setPlanStatus('OPEN')
    setPlanEnteredAt(enteredAt)
    setPlanClosedAt(null)
    setPlanExitMarketCap(null)
    setPlanExitValue(null)
    setPlanExitPnl(null)
    persistTradePlan({
      status:'OPEN',
      enteredAt,
      closedAt:null,
      exitMarketCap:null,
      exitValue:null,
      exitPnl:null,
    })
  }

  function closePlanAtCurrent(){
    const currentMc=Number(scan?.market?.marketCap||0)
    const principal=Number(investment||0)
    const entry=Number(entryMarketCap||0)
    if(!scan?.address||!currentMc||!principal||!entry) return

    const result=projectedPositionValue({
      investment:principal,
      entryMarketCap:entry,
      targetMarketCap:currentMc,
      estimatedCostsPercent:estimatedCosts,
    })
    const closedAt=Date.now()
    const exitValue=result?.netValue??null
    const exitPnl=result?.netProfit??null

    setPlanStatus('CLOSED')
    setPlanClosedAt(closedAt)
    setPlanExitMarketCap(currentMc)
    setPlanExitValue(exitValue)
    setPlanExitPnl(exitPnl)
    persistTradePlan({
      status:'CLOSED',
      closedAt,
      exitMarketCap:currentMc,
      exitValue,
      exitPnl,
    })
  }

  function resetPlanToDraft(){
    setPlanStatus('DRAFT')
    setPlanEnteredAt(null)
    setPlanClosedAt(null)
    setPlanExitMarketCap(null)
    setPlanExitValue(null)
    setPlanExitPnl(null)
    persistTradePlan({
      status:'DRAFT',
      enteredAt:null,
      closedAt:null,
      exitMarketCap:null,
      exitValue:null,
      exitPnl:null,
    })
  }

  async function copyTradePlan(){
    const lines=[
      (scan?.token?.symbol||'TOKEN')+' trade plan',
      'Position: '+money(Number(investment||0)),
      'Entry MC: '+money(Number(entryMarketCap||0)),
      'TP: +'+Number(takeProfitPercent||0)+'%',
      'Scale out: '+Number(scaleOutPercent||0)+'%',
      'Stop: -'+Number(stopDistance||0)+'%',
      'Thesis: '+(planThesis||'—'),
      'Invalidation: '+(planInvalidation||'—'),
      'RCXT: '+(scan?.intelligence?.signal||'WATCH')+' '+Number(scan?.intelligence?.score||0)+'/100',
    ]
    try{await navigator.clipboard.writeText(lines.join('\n'))}catch{}
  }

  async function copyProfitList(){
    if(!ladder.length) return
    const lines=[
      (scan?.token?.symbol||'TOKEN')+' profit list',
      'Position: '+money(Number(investment||0))+' | Entry MC: '+money(Number(entryMarketCap||0)),
      ...ladder.map(row=>money(row.targetMarketCap)+' MC → '+money(row.netValue)+' value ('+money(row.netProfit)+' P/L, '+row.multiple.toFixed(2)+'x)')
    ]
    try{await navigator.clipboard.writeText(lines.join('\n'))}catch{}
  }

  return (
    <div className="v4Suite" id="v4-market-lab">
      <article className="panel v4ChartPanel">
        <div className="v4PanelHead">
          <div><span>V4 MARKET LAB</span><h3>Real OHLCV chart + technical analytics</h3></div>
          <div className="intervalTabs">
            {['1m','5m','15m','1h'].map(value=>(
              <button key={value} className={interval===value?'active':''} onClick={()=>setIntervalValue(value)}>{value}</button>
            ))}
          </div>
        </div>

        {loading&&!chart?<div className="v4Loading">Loading real on-chain candles…</div>:null}
        {error?<div className="v4Error">{error}</div>:null}
        {limitedHistory?(
          <div className="chartHistoryNotice">
            <b>LIMITED HISTORY</b>
            <span>
              {Number.isFinite(pairAgeHours)&&pairAgeHours<1
                ? 'This pair is only '+Math.max(1,Math.round(pairAgeHours*60))+' minutes old. '
                : ''}
              RCXT currently has {candleCount} chart candles. 1m is usually the clearest view until more history builds.
            </span>
          </div>
        ):null}
        {chart?<CandleChart candles={chart.candles}/>:null}

        {analytics?.available?(
          <>
            <div className="technicalStrip">
              <div><span>Chart Bias</span><b className={analytics.trend==='BULLISH'?'good':analytics.trend==='BEARISH'?'bad':'mid'}>{analytics.trend}</b></div>
              <div><span>Model Confidence</span><b>{analytics.modelConfidence}%</b><small>not win probability</small></div>
              <div><span>RCXT + Chart</span><b className={consensus?.tone||'mid'}>{consensus?.label||'—'}</b><small>{consensus?.text||'Waiting for chart'}</small></div>
              <div><span>RSI 14</span><b>{analytics.indicators?.rsi14??'—'}</b></div>
              <div><span>ATR / Candle</span><b>{analytics.indicators?.atrPercent??'—'}%</b></div>
              <div><span>Volume Accel.</span><b>{analytics.indicators?.volumeAcceleration??'—'}×</b></div>
              <div><span>Max Drawdown</span><b className="bad">{pct(analytics.indicators?.maxDrawdown)}</b></div>
              <div><span>Data Quality</span><b>{analytics.dataQuality}%</b><small>{analytics.sampleSize} candles</small></div>
              <div><span>Structure</span><b>{analytics.regime?.structure||'—'}</b><small>{analytics.regime?.volatility||'—'} volatility</small></div>
              <div><span>Market phase</span><b>{analytics.regime?.phase||'—'}</b><small>{analytics.indicators?.bollingerWidthPercent==null?'—':analytics.indicators.bollingerWidthPercent+'%'} band width</small></div>
              <div><span>VWAP position</span><b className={Number(analytics.indicators?.vwapDistancePercent||0)>=0?'good':'bad'}>{analytics.indicators?.vwapDistancePercent==null?'—':pct(analytics.indicators.vwapDistancePercent)}</b><small>vs recent volume-weighted value</small></div>
              <div><span>Entry Quality</span><b>{entryQuality?.available?entryQuality.score+'/100':'—'}</b><small>{entryQuality?.available?entryQuality.label:'needs more evidence'}</small></div>
              <div><span>Structure R:R</span><b>{analytics.levels?.structureRiskReward?analytics.levels.structureRiskReward.toFixed(2)+'×':'—'}</b><small>nearest support → resistance</small></div>
            </div>

            {marketCapMap.available ? (
              <div className="marketCapMapPanel">
                <div className="marketCapMapHead">
                  <div>
                    <span>RCXT MARKET CAP MAP</span>
                    <strong>{marketCapMap.action}</strong>
                  </div>
                  <small>{marketCapMap.chartBased ? 'CHART-STRUCTURE BASED' : 'VOLATILITY ESTIMATE'}</small>
                </div>
                <div className="marketCapMapGrid">
                  <div><span>NOW</span><b>{money(marketCapMap.current)}</b><small>Current market cap</small></div>
                  <div className={marketCapMap.entryLow==null?'disabled':'entry'}>
                    <span>BUY / ENTRY ZONE</span>
                    <b>{marketCapMap.entryLow==null?'VETOED':money(marketCapMap.entryLow)+' – '+money(marketCapMap.entryHigh)}</b>
                    <small>{marketCapMap.entryLow==null?'Structural risk blocks an entry estimate':'Pullback / support area'}</small>
                  </div>
                  <div><span>BREAKOUT MC</span><b>{marketCapMap.breakout==null?'—':money(marketCapMap.breakout)}</b><small>Nearest resistance / confirmation</small></div>
                  <div className="good"><span>TRIM / SELL 1</span><b>{marketCapMap.trim1==null?'—':money(marketCapMap.trim1)}</b><small>First scale-out scenario</small></div>
                  <div className="good"><span>TAKE PROFIT 2</span><b>{marketCapMap.target2==null?'—':money(marketCapMap.target2)}</b><small>Higher resistance / scenario</small></div>
                  <div className="good"><span>STRETCH</span><b>{marketCapMap.stretch==null?'—':money(marketCapMap.stretch)}</b><small>High-volatility extension</small></div>
                  <div className="bad"><span>INVALIDATION MC</span><b>{marketCapMap.invalidation==null?'—':money(marketCapMap.invalidation)}</b><small>Structure/risk failure area</small></div>
                </div>
                <p>{marketCapMap.basis}. These are scenario zones, not promised prices or automatic trade instructions.</p>
              </div>
            ) : null}

            {tape?.summary?(
              <div className="tradeTape">
                <div className="tradeTapeHead">
                  <div><span>LIVE TRADE TAPE</span><strong>Recent USD flow</strong></div>
                  <small>{tape.summary.sampleSize} trades · {tape.summary.uniqueWallets} wallets</small>
                </div>
                <div className="tradeTapeStats">
                  <div><span>Buy volume</span><b className="good">{money(tape.summary.buyVolumeUsd)}</b><small>{tape.summary.buyVolumePercent}% of sample</small></div>
                  <div><span>Sell volume</span><b className="bad">{money(tape.summary.sellVolumeUsd)}</b><small>{100-tape.summary.buyVolumePercent}% of sample</small></div>
                  <div><span>Net flow</span><b className={tape.summary.netFlowUsd>=0?'good':'bad'}>{money(tape.summary.netFlowUsd)}</b></div>
                  <div><span>Largest buy</span><b>{money(tape.summary.largestBuyUsd)}</b></div>
                  <div><span>Largest sell</span><b>{money(tape.summary.largestSellUsd)}</b></div>
                  <div><span>Whale flow</span><b>{tape.summary.whaleBuyCount}B / {tape.summary.whaleSellCount}S</b><small>≥ {money(tape.summary.whaleThresholdUsd)}</small></div>
                </div>
                {tape.summary.flags?.length?(
                  <div className="tapeFlags">{tape.summary.flags.map(flag=><span key={flag}>{flag.replaceAll('_',' ')}</span>)}</div>
                ):null}

                <div className="whaleWalletPanel">
                  <div className="whaleWalletHead">
                    <div>
                      <span>WHALE WALLET DETECTION</span>
                      <strong>Large sampled participants</strong>
                    </div>
                    <div className="whaleNet">
                      <span>Whale net flow</span>
                      <b className={Number(tape.summary.whaleWalletNetFlowUsd||0)>=0?'good':'bad'}>
                        {money(tape.summary.whaleWalletNetFlowUsd)}
                      </b>
                    </div>
                  </div>

                  <div className="whaleSummaryGrid">
                    <div><span>Detected wallets</span><b>{tape.summary.whaleWalletCount||0}</b></div>
                    <div><span>Accumulating</span><b className="good">{tape.summary.accumulatingWhales||0}</b></div>
                    <div><span>Distributing</span><b className="bad">{tape.summary.distributingWhales||0}</b></div>
                    <div><span>Largest share</span><b>{tape.summary.topWhaleVolumeSharePercent||0}%</b></div>
                  </div>

                  {tape.whaleWallets?.length ? (
                    <div className="whaleWalletList">
                      {tape.whaleWallets.slice(0,6).map((wallet)=>(
                        <a key={wallet.wallet} href={wallet.explorerUrl} target="_blank" rel="noreferrer">
                          <div>
                            <strong>{wallet.wallet.slice(0,5)}…{wallet.wallet.slice(-5)}</strong>
                            <span>{wallet.tradeCount} trades · {wallet.volumeSharePercent}% of sampled USD volume</span>
                          </div>
                          <div className="whaleWalletNumbers">
                            <b className={wallet.netFlowUsd>=0?'good':'bad'}>{wallet.netFlowUsd>=0?'+':''}{money(wallet.netFlowUsd)}</b>
                            <small className={wallet.direction==='ACCUMULATING'?'good':wallet.direction==='DISTRIBUTING'?'bad':'mid'}>{wallet.direction}</small>
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <small className="whaleEmpty">No sampled wallet crossed RCXT's relative whale threshold.</small>
                  )}

                  <p>Whale labels are based only on relative activity in this recent public trade sample—not wallet identity, net worth, or ownership.</p>
                </div>
              </div>
            ):null}

            <div className="forecastGrid">
              <ForecastCard label="NEXT 15M RANGE" forecast={analytics.forecast?.m15}/>
              <ForecastCard label="NEXT 1H RANGE" forecast={analytics.forecast?.h1}/>
              <ForecastCard label="NEXT 6H RANGE" forecast={analytics.forecast?.h6}/>
            </div>
            <div className="levelsGrid">
              <div>
                <span>SUPPORT ZONES</span>
                {(analytics.levels?.support||[]).map(value=><b key={value}>{tiny(value)}</b>)}
                <small>Nearest: {tiny(analytics.levels?.nearestSupport)} · {analytics.levels?.downsideToSupportPercent==null?'—':analytics.levels.downsideToSupportPercent.toFixed(1)+'% below'}</small>
              </div>
              <div>
                <span>RESISTANCE ZONES</span>
                {(analytics.levels?.resistance||[]).map(value=><b key={value}>{tiny(value)}</b>)}
                <small>Nearest: {tiny(analytics.levels?.nearestResistance)} · {analytics.levels?.upsideToResistancePercent==null?'—':analytics.levels.upsideToResistancePercent.toFixed(1)+'% above'}</small>
              </div>
              <div><span>WHY</span>{(analytics.reasons||[]).map(value=><small key={value}>+ {value}</small>)}</div>
              <div><span>RISKS</span>{(analytics.risks||[]).map(value=><small key={value}>− {value}</small>)}</div>
            </div>
            <p className="forecastDisclaimer">{analytics.disclaimer}</p>
          </>
        ):null}
      </article>

      <article className="panel rugGuardPanel">
        <div className="v4PanelHead">
          <div>
            <span>RUG / MANIPULATION GUARD</span>
            <h3>Structural red-flag evidence</h3>
          </div>
          <div className={'rugGuardStatus '+String(rugGuard?.label||'UNAVAILABLE').replaceAll(' ','-').toLowerCase()}>
            <strong>{rugGuard?.label||'UNAVAILABLE'}</strong>
            <small>{rugGuard?.critical||0} critical · {rugGuard?.warning||0} warnings · {rugGuard?.unknown||0} unknown</small>
          </div>
        </div>
        <div className="rugGuardGrid">
          {(rugGuard?.items||[]).map((item)=>(
            <div className={'rugGuardRow '+item.severity} key={item.key}>
              <span className="rugDot" />
              <div>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
              <b>{item.severity.toUpperCase()}</b>
            </div>
          ))}
        </div>

        {scan?.security?.topOwners?.length ? (
          <div className="supplyWhaleBlock">
            <div className="supplyWhaleHead">
              <div>
                <span>SUPPLY WHALES</span>
                <strong>Resolved owner concentration</strong>
              </div>
              <small>{scan.security.supplyWhaleCount||0} owner wallets ≥5% of supply</small>
            </div>
            <div className="supplyWhaleList">
              {scan.security.topOwners.slice(0,6).map((holder)=>(
                <a key={holder.owner} href={holder.explorerUrl} target="_blank" rel="noreferrer">
                  <div>
                    <strong>{holder.owner.slice(0,5)}…{holder.owner.slice(-5)}</strong>
                    <span>Resolved token-account owner</span>
                  </div>
                  <b className={Number(holder.supplyPercent||0)>=10?'bad':Number(holder.supplyPercent||0)>=5?'mid':'good'}>
                    {Number(holder.supplyPercent||0).toFixed(2)}%
                  </b>
                </a>
              ))}
            </div>
            <p>Supply-whale data comes from public Solana token-account ownership resolution. It does not identify the person or entity controlling a wallet.</p>
          </div>
        ) : null}

        <p>{rugGuard?.meaning}</p>
      </article>

      <article className="panel provenancePanel">
        <div className="v4PanelHead">
          <div><span>DATA PROVENANCE</span><h3>Know what is measured vs calculated</h3></div>
        </div>
        <div className="provenanceGrid">
          <div><b>MEASURED</b><strong>Market / wallet / trades</strong><p>DexScreener prices and liquidity, GeckoTerminal candles/trades, Solana wallet and mint data.</p></div>
          <div><b>COMPUTED</b><strong>RCXT / Trench / Entry Quality</strong><p>Deterministic formulas derived from measured inputs. Useful for comparison, not a guaranteed outcome.</p></div>
          <div><b>ESTIMATED</b><strong>Forecast ranges / profit scenarios</strong><p>Volatility and market-cap scenarios. They are not promised future prices or probabilities.</p></div>
        </div>
      </article>

      <div className="v4TwoCol">
        <article className="panel beginnerPanel">
          <div className="v4PanelHead"><div><span>BEGINNER MODE</span><h3>Explain it like I’m new</h3></div></div>
          <div className="beginnerCards">
            {beginner.map(item=><div key={item.title}><strong>{item.title}</strong><p>{item.text}</p></div>)}
          </div>
        </article>

        <article className="panel riskPlannerPanel">
          <div className="v4PanelHead"><div><span>POSITION PLANNER</span><h3>Risk budget before position size</h3></div></div>
          <div className="plannerInputs">
            <label><span>Account value</span><input inputMode="decimal" value={accountValue} onChange={e=>setAccountValue(e.target.value)} placeholder="100"/></label>
            <label><span>Max risk %</span><input inputMode="decimal" value={riskPercent} onChange={e=>setRiskPercent(e.target.value)}/></label>
            <label><span>Stop distance %</span><input inputMode="decimal" value={stopDistance} onChange={e=>setStopDistance(e.target.value)}/></label>
          </div>
          <div className="plannerResults">
            <div><span>Risk budget</span><b>{money(riskPlan.riskBudget)}</b></div>
            <div><span>Max position</span><b>{money(riskPlan.positionSize)}</b></div>
            <div><span>% of account</span><b>{riskPlan.positionPercent.toFixed(1)}%</b></div>
            <div><span>Liquidity burden</span><b className={liquidityBurden?.label==='LOW'?'good':liquidityBurden?.label==='MODERATE'?'mid':'bad'}>{liquidityBurden?liquidityBurden.percent.toFixed(2)+'%':'—'}</b><small>{liquidityBurden?.label||'No liquidity data'}</small></div>
          </div>
          <p>Uses your chosen stop distance. Liquidity burden compares planned position size with reported pool liquidity. Real losses can exceed the estimate because of slippage or failed exits.</p>
        </article>
      </div>

      <div className="v4TwoCol">
        <article className="panel decisionPanel">
          <div className="v4PanelHead"><div><span>DECISION STACK</span><h3>RCXT + chart + tape confluence</h3></div></div>
          <div className={'decisionBadge '+decisionSummary.label.replaceAll(' ','-').toLowerCase()}>{decisionSummary.label}</div>
          <div className="decisionColumns">
            <div><span>CONFIRMING</span>{(decisionSummary.positives.length?decisionSummary.positives:['No strong confirmation yet']).map(item=><p key={item}>+ {item}</p>)}</div>
            <div><span>CONFLICTS / RISKS</span>{(decisionSummary.warnings.length?decisionSummary.warnings:['No major conflict detected']).map(item=><p key={item}>− {item}</p>)}</div>
          </div>
          <small>This combines independent layers; it is not a probability of profit.</small>
        </article>

        <article className="panel exitPlannerPanel">
          <div className="v4PanelHead"><div><span>EXIT PLANNER</span><h3>Plan the trade before the trade plans you</h3></div></div>
          <div className="plannerInputs">
            <label><span>TP target %</span><input inputMode="decimal" value={takeProfitPercent} onChange={e=>setTakeProfitPercent(e.target.value)}/></label>
            <label><span>Scale out %</span><input inputMode="decimal" value={scaleOutPercent} onChange={e=>setScaleOutPercent(e.target.value)}/></label>
            <label><span>Stop %</span><input inputMode="decimal" value={stopDistance} onChange={e=>setStopDistance(e.target.value)}/></label>
          </div>
          <div className="plannerResults">
            <div><span>Target value</span><b>{money(exitPlan.targetValue)}</b></div>
            <div><span>Stop value</span><b>{money(exitPlan.stopValue)}</b></div>
            <div><span>Take off at TP</span><b>{money(exitPlan.firstScaleValue)}</b><small>{exitPlan.scale}% scale</small></div>
            <div><span>Runner</span><b>{money(exitPlan.runnerValue)}</b></div>
          </div>
          <p>Simple planning math only. Real fills can differ because of liquidity, slippage, fees, taxes, and fast price changes.</p>
        </article>
      </div>

      <article className="panel executionLabPanel">
        <div className="v4PanelHead">
          <div><span>EXECUTION LAB</span><h3>Plan the trade before the trade plans you</h3></div>
          <button className="toolButton" onClick={copyFullReport}>Copy full report</button>
        </div>

        <div className="executionTop">
          <div className="readinessGauge">
            <span>CONFIRMATION CHECKS</span>
            <strong>{checklist?.knownCount ? checklist.readinessPercent : 0}%</strong>
            <small>{checklist?.passCount || 0}/{checklist?.knownCount || 0} known checks passing</small>
            <i><em style={{width:(checklist?.readinessPercent || 0)+'%'}} /></i>
          </div>

          <div className="reverseTargetBox">
            <label>
              <span>I want this position worth</span>
              <input inputMode="decimal" value={targetPositionValue} onChange={e=>setTargetPositionValue(e.target.value)} />
            </label>
            <div>
              <span>Required market cap</span>
              <strong>{reverseTarget?money(reverseTarget.requiredMarketCap):'—'}</strong>
              <small>{reverseTarget?reverseTarget.multiple.toFixed(2)+'× from entry MC':'Enter valid position + MC'}</small>
            </div>
            <div>
              <span>Break-even MC</span>
              <strong>{breakEven?money(breakEven.marketCap):'—'}</strong>
              <small>{breakEven?breakEven.multiple.toFixed(3)+'× after estimated costs':'—'}</small>
            </div>
          </div>
        </div>

        <div className="executionChecklist">
          {(checklist?.items || []).map(item=>(
            <div key={item.key} className={item.unknown?'unknown':item.pass?'pass':'fail'}>
              <span className="checkMark">{item.unknown?'?':item.pass?'✓':'!'}</span>
              <div><strong>{item.label}</strong><small>{item.detail}</small></div>
            </div>
          ))}
        </div>

        {analytics?.available ? (
          <div className="entryMap">
            <div>
              <span>Current</span>
              <b>{tiny(analytics.latestPrice)}</b>
            </div>
            <div>
              <span>Nearest support</span>
              <b>{tiny(analytics.levels?.nearestSupport)}</b>
              <small>{analytics.levels?.downsideToSupportPercent==null?'—':analytics.levels.downsideToSupportPercent.toFixed(1)+'%'}</small>
            </div>
            <div>
              <span>Nearest resistance</span>
              <b>{tiny(analytics.levels?.nearestResistance)}</b>
              <small>{analytics.levels?.upsideToResistancePercent==null?'—':'+'+analytics.levels.upsideToResistancePercent.toFixed(1)+'%'}</small>
            </div>
            <div>
              <span>Structure R:R</span>
              <b>{analytics.levels?.structureRiskReward?analytics.levels.structureRiskReward.toFixed(2)+'×':'—'}</b>
              <small>support → resistance</small>
            </div>
          </div>
        ) : null}

        <p className="profitNote">
          Confirmation checks are descriptive—not a buy signal. Support/resistance can fail, pool liquidity can disappear, and realized slippage can be worse than the planner.
        </p>
      </article>

      <article className="panel tradePlanPanel">
        <div className="v4PanelHead">
          <div><span>SAVED TRADE PLAN</span><h3>Pre-commit your entry, exit, and invalidation</h3></div>
          <div className="tradePlanActions">
            <button className={planAlerts?'toolButton active':'toolButton'} onClick={togglePlanAlerts}>
              {planAlerts?'Plan Alerts On':'Plan Alerts Off'}
            </button>
            <button className="toolButton" onClick={copyTradePlan}>Copy plan</button>
            <button className="toolButton active" onClick={saveTradePlan}>Save plan</button>
          </div>
        </div>
        <div className="tradePlanGrid">
          <label><span>Position</span><input inputMode="decimal" value={investment} onChange={e=>setInvestment(e.target.value)}/></label>
          <label><span>Entry MC</span><input inputMode="decimal" value={entryMarketCap} onChange={e=>setEntryMarketCap(e.target.value)}/></label>
          <label><span>TP %</span><input inputMode="decimal" value={takeProfitPercent} onChange={e=>setTakeProfitPercent(e.target.value)}/></label>
          <label><span>Scale out %</span><input inputMode="decimal" value={scaleOutPercent} onChange={e=>setScaleOutPercent(e.target.value)}/></label>
          <label><span>Stop %</span><input inputMode="decimal" value={stopDistance} onChange={e=>setStopDistance(e.target.value)}/></label>
        </div>
        <div className="tradePlanNotes">
          <label><span>Thesis</span><textarea value={planThesis} onChange={e=>setPlanThesis(e.target.value)} placeholder="Why am I entering? Catalyst / setup / flow…"/></label>
          <label><span>Invalidation</span><textarea value={planInvalidation} onChange={e=>setPlanInvalidation(e.target.value)} placeholder="What specifically makes me exit or stop believing the setup?"/></label>
        </div>
        {livePosition.available ? (
          <div className="livePlanTracker">
            <div className="livePlanHead">
              <div>
                <span>LIVE PLAN TRACKER</span>
                <strong className={
                  livePosition.status==='TARGET ZONE'?'good':
                  livePosition.status==='STOP / INVALIDATION ZONE'?'bad':
                  livePosition.status==='IN PROFIT'?'good':'mid'
                }>{livePosition.status}</strong>
              </div>
              <small>Uses live market-cap ratio · supply assumed comparable</small>
            </div>
            <div className="livePlanGrid">
              <div><span>Est. current value</span><b>{money(livePosition.current?.netValue)}</b></div>
              <div><span>Est. P/L</span><b className={Number(livePosition.current?.netProfit||0)>=0?'good':'bad'}>{money(livePosition.current?.netProfit)}</b></div>
              <div><span>From entry MC</span><b className={livePosition.movePercent>=0?'good':'bad'}>{pct(livePosition.movePercent)}</b></div>
              <div><span>TP market cap</span><b>{money(livePosition.targetMarketCap)}</b><small>{livePosition.targetDistancePercent==null?'—':pct(livePosition.targetDistancePercent)} from current</small></div>
              <div><span>Stop market cap</span><b>{money(livePosition.stopMarketCap)}</b><small>{livePosition.stopDistanceFromCurrent==null?'—':pct(livePosition.stopDistanceFromCurrent)} from current</small></div>
              <div><span>Remaining R:R</span><b>{livePosition.remainingRiskReward==null?'—':livePosition.remainingRiskReward.toFixed(2)+'×'}</b><small>to plan target vs stop</small></div>
            </div>
          </div>
        ) : null}

        <div className="tradeJournalBar">
          <div>
            <span>JOURNAL STATUS</span>
            <strong className={
              planStatus==='OPEN'?'good':
              planStatus==='CLOSED'?(Number(planExitPnl||0)>=0?'good':'bad'):'mid'
            }>{planStatus}</strong>
            <small>
              {planStatus==='OPEN'&&planEnteredAt?'Entered '+new Date(planEnteredAt).toLocaleString():
               planStatus==='CLOSED'&&planClosedAt?'Closed '+new Date(planClosedAt).toLocaleString():
               'Saving a plan does not mean you entered the trade.'}
            </small>
          </div>
          <div className="tradeJournalActions">
            {planStatus!=='OPEN'?<button onClick={markPlanEntered}>Mark entered</button>:null}
            {planStatus==='OPEN'?<button className="closeTradeButton" onClick={closePlanAtCurrent}>Close @ current MC</button>:null}
            {planStatus!=='DRAFT'?<button onClick={resetPlanToDraft}>Reset to draft</button>:null}
          </div>
        </div>

        {planStatus==='CLOSED' ? (
          <div className="closedTradeSummary">
            <div><span>Exit MC</span><b>{money(planExitMarketCap)}</b></div>
            <div><span>Est. exit value</span><b>{money(planExitValue)}</b></div>
            <div><span>Est. P/L</span><b className={Number(planExitPnl||0)>=0?'good':'bad'}>{money(planExitPnl)}</b></div>
          </div>
        ) : null}

        <div className="tradePlanFoot">
          <span>{planSavedAt?'Saved '+new Date(planSavedAt).toLocaleString():'Not saved yet'}</span>
          <small>Stored locally on this device. Plan alerts work while RCXT is running; RCXT does not execute trades.</small>
        </div>
      </article>

      <article className="panel profitLadderPanel">
        <div className="v4PanelHead">
          <div><span>PROFIT LIST</span><h3>Instant “what if it hits…” market-cap math</h3></div>
          <button className="toolButton" onClick={copyProfitList}>Copy profit list</button>
        </div>

        <div className="quickProfitPresets">
          {[20,40,100].map((value)=>(
            <button key={value} onClick={()=>setInvestment(String(value))}>
              {'$'+value+' position'}
            </button>
          ))}
          {scan?.market?.marketCap ? (
            <button onClick={()=>setEntryMarketCap(String(Math.round(scan.market.marketCap)))}>
              Use live MC
            </button>
          ) : null}
        </div>

        <div className="profitInputs">
          <label><span>Position ($)</span><input inputMode="decimal" value={investment} onChange={e=>setInvestment(e.target.value)}/></label>
          <label><span>Entry MC ($)</span><input inputMode="decimal" value={entryMarketCap} onChange={e=>setEntryMarketCap(e.target.value)}/></label>
          <label><span>Custom target MC</span><input inputMode="decimal" value={customTarget} onChange={e=>setCustomTarget(e.target.value)} placeholder="100000"/></label>
          <label><span>Est. total costs %</span><input inputMode="decimal" value={estimatedCosts} onChange={e=>setEstimatedCosts(e.target.value)}/></label>
        </div>

        {customProjection ? (
          <div className="customProfitResult">
            <span>Custom target</span>
            <strong>{money(customProjection.netValue)}</strong>
            <b>{money(customProjection.netProfit)} est. P/L · {customProjection.multiple.toFixed(2)}× MC</b>
          </div>
        ) : null}

        <div className="profitTableWrap">
          <table className="profitTable">
            <thead>
              <tr><th>Target MC</th><th>MC multiple</th><th>Position value</th><th>Est. P/L</th><th>ROI</th></tr>
            </thead>
            <tbody>
              {ladder.map((row)=>(
                <tr key={row.targetMarketCap}>
                  <td>{money(row.targetMarketCap)}</td>
                  <td>{row.multiple.toFixed(2)}×</td>
                  <td>{money(row.netValue)}</td>
                  <td className={row.netProfit>=0?'positiveText':'negativeText'}>{money(row.netProfit)}</td>
                  <td>{pct(row.roiPercent,0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="profitNote">
          MC-ratio math assumes comparable supply. Real fills differ with slippage, liquidity, fees, taxes, supply changes, and execution.
        </p>
      </article>
    </div>
  )
}
