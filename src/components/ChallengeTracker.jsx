'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { challengeStats } from '../lib/trading-math.js'

function money(value){
  const n=Number(value)
  if(!Number.isFinite(n)) return '—'
  if(Math.abs(n)>=1000000) return '$'+(n/1000000).toFixed(n>=10000000?1:2)+'M'
  if(Math.abs(n)>=1000) return '$'+(n/1000).toFixed(n>=100000?0:1)+'K'
  return n.toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:n<10?2:0})
}

function pct(value,digits=1){
  const n=Number(value)
  return Number.isFinite(n)?(n>=0?'+':'')+n.toFixed(digits)+'%':'—'
}

function EquitySparkline({rows,current}){
  const values=[...(rows||[]).map(row=>Number(row.totalValueUsd||0)),Number(current||0)].filter(Number.isFinite)
  if(values.length<2) return <div className="challengeEmptyChart">Sync more snapshots to build the equity curve.</div>
  const width=700,height=150,pad=10
  const min=Math.min(...values),max=Math.max(...values)
  const range=Math.max(1,max-min)
  const points=values.map((value,index)=>{
    const x=pad+(index/(values.length-1))*(width-pad*2)
    const y=pad+((max-value)/range)*(height-pad*2)
    return x+','+y
  }).join(' ')
  return (
    <svg className="equitySparkline" viewBox={'0 0 '+width+' '+height} role="img" aria-label="Challenge wallet equity history">
      <polyline points={points}/>
    </svg>
  )
}

export default function ChallengeTracker({walletAddress='',walletData=null}){
  const [address,setAddress]=useState('')
  const [data,setData]=useState(null)
  const [current,setCurrent]=useState(0)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [startedAt,setStartedAt]=useState(null)

  useEffect(()=>{
    const saved=localStorage.getItem('rcxt-challenge-wallet-v1')||''
    const nextAddress=walletAddress||saved
    setAddress(nextAddress)
    if(nextAddress){
      const savedStart=localStorage.getItem('rcxt-challenge-start-v1:'+nextAddress)
      setStartedAt(savedStart?Number(savedStart):null)
    }
  },[walletAddress])

  useEffect(()=>{
    if(walletData?.portfolioTotalUsd!=null) setCurrent(Number(walletData.portfolioTotalUsd||0))
  },[walletData?.portfolioTotalUsd])

  const scopedRows=useMemo(()=>{
    if(!startedAt) return data?.rows||[]
    return (data?.rows||[]).filter(row=>new Date(row.createdAt).getTime()>=startedAt)
  },[data?.rows,startedAt])

  const stats=useMemo(()=>challengeStats(current,scopedRows),[current,scopedRows])
  const performance=useMemo(()=>{
    const first=Number(scopedRows?.[0]?.totalValueUsd||0)
    const latest=Number(current||scopedRows?.at(-1)?.totalValueUsd||0)
    const values=(scopedRows||[]).map(row=>Number(row.totalValueUsd||0)).filter(Number.isFinite)
    const changeUsd=first>0?latest-first:null
    const changePct=first>0?((latest/first)-1)*100:null
    const best=values.length?Math.max(...values):latest
    const worst=values.length?Math.min(...values):latest
    const next=Number(stats.nextMilestone||0)
    return {
      first,
      latest,
      changeUsd,
      changePct,
      best,
      worst,
      toNext:next>latest?next-latest:0,
      snapshots:scopedRows?.length||0,
    }
  },[scopedRows,current,stats.nextMilestone])

  async function sync(){
    const target=address.trim()
    if(!target) return
    setLoading(true)
    setError('')
    try{
      localStorage.setItem('rcxt-challenge-wallet-v1',target)
      let start=Number(localStorage.getItem('rcxt-challenge-start-v1:'+target)||0)
      if(!start){
        start=Date.now()
        localStorage.setItem('rcxt-challenge-start-v1:'+target,String(start))
      }
      setStartedAt(start)

      const walletResponse=await fetch('/api/wallet?address='+encodeURIComponent(target),{cache:'no-store'})
      const walletJson=await walletResponse.json()
      if(!walletResponse.ok||!walletJson?.success) throw new Error(walletJson?.error||'Wallet sync failed')
      const equity=Number(walletJson.portfolioTotalUsd??walletJson.portfolioTokenValueUsd??0)
      setCurrent(equity)

      const historyResponse=await fetch('/api/challenge?address='+encodeURIComponent(target),{cache:'no-store'})
      const historyJson=await historyResponse.json()
      if(!historyResponse.ok||!historyJson?.success) throw new Error(historyJson?.error||'Challenge history failed')
      setData(historyJson)
    }catch(err){
      setError(err.message)
    }finally{
      setLoading(false)
    }
  }

  function resetChallenge(){
    const target=address.trim()
    if(!target) return
    const now=Date.now()
    localStorage.setItem('rcxt-challenge-start-v1:'+target,String(now))
    setStartedAt(now)
    setData((currentData)=>currentData?{...currentData,rows:[]}:currentData)
  }

  return (
    <article className="panel challengePanel">
      <div className="challengeHead">
        <div>
          <span>$5 → $50K CHALLENGE</span>
          <h3>Wallet equity tracker</h3>
          <p>Measurement dashboard — not a promise that $5 can or will become $50K.</p>
        </div>
        <div className="challengeMultiple"><span>TOTAL TARGET</span><b>10,000×</b></div>
      </div>

      <div className="challengeSync">
        <input value={address} onChange={e=>setAddress(e.target.value)} placeholder="Paste challenge wallet address" aria-label="Challenge wallet address"/>
        <button className="primaryButton" onClick={sync} disabled={loading}>{loading?'SYNCING…':'SYNC WALLET'}</button>
      </div>
      {error?<div className="v4Error">{error}</div>:null}

      <div className="challengeStats">
        <div><span>Current equity</span><b>{money(stats.current)}</b></div>
        <div><span>From $5</span><b>{stats.current>0?stats.multiple.toFixed(2)+'×':'—'}</b></div>
        <div><span>Next milestone</span><b>{money(stats.nextMilestone)}</b></div>
        <div><span>Needed to next</span><b>{stats.percentToNext==null?'—':pct(stats.percentToNext,0)}</b></div>
        <div><span>High-water mark</span><b>{money(Math.max(stats.highWater,Number(data?.highWater||0)))}</b></div>
        <div><span>Drawdown</span><b className={stats.drawdownPercent<0?'bad':''}>{pct(stats.drawdownPercent)}</b></div>
      </div>

      <div className="challengePerformance">
        <div>
          <span>Since tracker start</span>
          <b className={performance.changePct==null?'':performance.changePct>=0?'good':'bad'}>
            {performance.changePct==null?'—':pct(performance.changePct)}
          </b>
          <small>{performance.changeUsd==null?'No baseline yet':money(performance.changeUsd)+' equity change'}</small>
        </div>
        <div>
          <span>Best tracked equity</span>
          <b>{money(performance.best)}</b>
          <small>{performance.snapshots} saved snapshots</small>
        </div>
        <div>
          <span>Lowest tracked equity</span>
          <b>{money(performance.worst)}</b>
          <small>Measures drawdown history, not only gains</small>
        </div>
        <div>
          <span>To next milestone</span>
          <b>{money(performance.toNext)}</b>
          <small>{stats.requiredMultiple?stats.requiredMultiple.toFixed(1)+'× remains to $50K':'Sync wallet for goal math'}</small>
        </div>
      </div>

      <div className="challengeProgress">
        <div><span>Log-scale progress</span><b>{stats.progress.toFixed(1)}%</b></div>
        <i><em style={{width:stats.progress+'%'}}/></i>
      </div>

      <div className="milestoneGrid">
        {[5,10,25,50,100,250,500,1000,2500,5000,10000,25000,50000].map(value=>(
          <div key={value} className={stats.current>=value?'done':''}><span>{money(value)}</span><b>{stats.current>=value?'✓':'○'}</b></div>
        ))}
      </div>

      <EquitySparkline rows={scopedRows} current={stats.current}/>

      {stats.drawdownPercent <= -20 ? (
        <div className="challengeRiskNotice">
          <strong>Drawdown guard</strong>
          <span>Equity is more than 20% below the tracked high-water mark. The challenge dashboard is flagging capital preservation—not asking you to trade bigger to catch up.</span>
        </div>
      ) : null}

      <div className="challengeFoot">
        <span>{scopedRows.length} challenge snapshots{startedAt?' · started '+new Date(startedAt).toLocaleDateString():''}</span>
        <span>{stats.requiredMultiple?stats.requiredMultiple.toFixed(1)+'× from current equity to $50K':'Sync a wallet to begin tracking'}</span>
        <button className="challengeReset" onClick={resetChallenge}>Reset challenge start</button>
      </div>
    </article>
  )
}
