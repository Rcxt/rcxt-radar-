'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { beginnerMarketExplanation, buildProfitLadder, positionPlan, projectedPositionValue } from '../lib/trading-math.js'

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

  useEffect(()=>{
    setEntryMarketCap(scan?.market?.marketCap?String(Math.round(scan.market.marketCap)):'')
  },[scan?.address])

  useEffect(()=>{
    if(walletEquity>0) setAccountValue(String(Number(walletEquity).toFixed(2)))
  },[walletEquity])

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
      } : null,
      tape: tape?.summary || null,
    })
  },[analytics,tape?.summary,onContext])

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
    const signal=String(scan?.intelligence?.signal||'')
    const coreBull=['BUY SETUP','LEAN BUY'].includes(signal)
    const coreBear=['REDUCE','SELL / AVOID'].includes(signal)
    const chartBull=analytics.trend==='BULLISH'
    const chartBear=analytics.trend==='BEARISH'
    if((coreBull&&chartBull)||(coreBear&&chartBear)) return {label:'ALIGNED',tone:'good',text:'RCXT market structure and candle model point in the same direction.'}
    if((coreBull&&chartBear)||(coreBear&&chartBull)) return {label:'CONFLICT',tone:'bad',text:'RCXT and candle structure disagree. Treat the setup as lower-conviction until they converge.'}
    return {label:'MIXED',tone:'mid',text:'At least one layer is neutral or watch-only. Confirmation is incomplete.'}
  },[analytics?.available,analytics?.trend,scan?.intelligence?.signal])

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
    <div className="v4Suite">
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
              <div><span>Structure R:R</span><b>{analytics.levels?.structureRiskReward?analytics.levels.structureRiskReward.toFixed(2)+'×':'—'}</b><small>nearest support → resistance</small></div>
            </div>
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

      <article className="panel profitLadderPanel">
        <div className="v4PanelHead">
          <div><span>PROFIT LIST</span><h3>Instant “what if it hits…” market-cap math</h3></div>
          <button className="toolButton" onClick={copyProfitList}>Copy profit list</button>
        </div>
        <div className="profitInputs">
          <label><span>Position ($)</span><input inputMode="decimal" value={investment} onChange={e=>setInvestment(e.target.value)}/></label>
          <label><span>Entry MC ($)</span><input inputMode="decimal" value={entryMarketCap} onChange={e=>setEntryMarketCap(e.target.value)}/></label>
          <label><span>Custom target MC</span><input inputMode="decimal" value={customTarget} onChange={e=>setCustomTarget(e.target.value)} placeholder="100000"/></label>
          <label><span>Est. total costs %</span><input inputMode="decimal" value={estimatedCosts} onChange={e=>setEstimatedCosts(e.target.value)}/></label>
        </div>
        {customProjection?(
          <div className="customProfitResult">
            <span>Custom target</span><strong>{money(customProjection.netValue)}</strong>
            <b>{money(customProjection.netProfit)} est. P/L · {customProjection.multiple.toFixed(2)}× MC</b>
          </div>
        ):null}
        <div className="profitTableWrap">
          <table className="profitTable">
            <thead><tr><th>Target MC</th><th>MC multiple</th><th>Position value</th><th>Est. P/L</th><th>ROI</th></tr></thead>
            <tbody>
              {ladder.map(row=>(
                <tr key={row.targetMarketCap}>
                  <td>{money(row.targetMarketCap)}</td><td>{row.multiple.toFixed(2)}×</td><td>{money(row.netValue)}</td>
                  <td className={row.netProfit>=0?'positiveText':'negativeText'}>{money(row.netProfit)}</td><td>{pct(row.roiPercent,0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="profitNote">MC-ratio math assumes comparable supply. Real fills differ with slippage, liquidity, fees, taxes, supply changes, and execution.</p>
      </article>
    </div>
  )
}
