'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'

function short(value,size=5){
  const text=String(value||'')
  return text.length>size*2+3 ? text.slice(0,size)+'…'+text.slice(-size) : text
}

function number(value,digits=4){
  const n=Number(value)
  if(!Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined,{maximumFractionDigits:digits})
}

function signed(value,digits=5){
  const n=Number(value)
  if(!Number.isFinite(n)) return '—'
  return (n>0?'+':'')+n.toFixed(digits)
}

function age(iso){
  const time=new Date(iso||0).getTime()
  if(!time) return '—'
  const seconds=Math.max(0,(Date.now()-time)/1000)
  if(seconds<60) return Math.round(seconds)+'s ago'
  if(seconds<3600) return Math.round(seconds/60)+'m ago'
  if(seconds<86400) return (seconds/3600).toFixed(1)+'h ago'
  return (seconds/86400).toFixed(1)+'d ago'
}

function typeTone(type){
  if(type==='BUY'||type==='RECEIVE') return 'good'
  if(type==='SELL'||type==='SEND') return 'bad'
  if(type==='SWAP') return 'mid'
  return ''
}

export default function WalletActivity({walletAddress='',onOpenToken}){
  const [data,setData]=useState(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [scores,setScores]=useState({})
  const [autoScore,setAutoScore]=useState(false)
  const [lastRefresh,setLastRefresh]=useState(null)
  const scoringRef=useRef(new Set())

  const address=String(walletAddress||'').trim()
  const valid=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)

  useEffect(()=>{
    setAutoScore(localStorage.getItem('rcxt-activity-auto-score-v1')==='enabled')
  },[])

  async function loadActivity({silent=false}={}){
    if(!valid) return
    if(!silent) setLoading(true)
    setError('')
    try{
      const response=await fetch('/api/activity?address='+encodeURIComponent(address)+'&limit=15',{cache:'no-store'})
      const json=await response.json()
      if(!response.ok||!json?.success) throw new Error(json?.error||'Wallet activity unavailable')
      setData(json)
      setLastRefresh(Date.now())
    }catch(err){
      setError(err?.message||'Wallet activity unavailable')
    }finally{
      if(!silent) setLoading(false)
    }
  }

  useEffect(()=>{
    if(!valid){
      setData(null)
      return
    }
    loadActivity()
    const timer=setInterval(()=>loadActivity({silent:true}),30000)
    return()=>clearInterval(timer)
  },[address])

  async function scoreMint(mint){
    if(!mint||scoringRef.current.has(mint)) return
    scoringRef.current.add(mint)
    setScores(current=>({...current,[mint]:{loading:true}}))
    try{
      const response=await fetch('/api/scan?address='+encodeURIComponent(mint)+'&persist=0',{cache:'no-store'})
      const json=await response.json()
      if(!response.ok||!json?.success) throw new Error(json?.error||'Score unavailable')
      setScores(current=>({...current,[mint]:{
        loading:false,
        score:json.scan?.intelligence?.score,
        signal:json.scan?.intelligence?.signal,
        risk:json.scan?.intelligence?.risk,
      }}))
    }catch(err){
      setScores(current=>({...current,[mint]:{loading:false,error:err?.message||'Score unavailable'}}))
    }finally{
      scoringRef.current.delete(mint)
    }
  }

  async function scoreRecentBuys(){
    const mints=[...new Set((data?.newBuys||[]).map(item=>item?.token?.address).filter(Boolean))].slice(0,4)
    await Promise.all(mints.map(scoreMint))
  }

  useEffect(()=>{
    if(!autoScore||!data?.newBuys?.length) return
    scoreRecentBuys()
  },[autoScore,data?.generatedAt])

  function toggleAutoScore(){
    const next=!autoScore
    setAutoScore(next)
    localStorage.setItem('rcxt-activity-auto-score-v1',next?'enabled':'disabled')
  }

  const visibleEvents=useMemo(()=>data?.events?.slice(0,12)||[],[data?.events])

  return (
    <article className="panel walletActivityPanel">
      <div className="walletActivityHead">
        <div>
          <span>WALLET ACTIVITY INTELLIGENCE</span>
          <h3>Recent on-chain token activity</h3>
          <p>Trade classification is conservative: token flow plus SOL/stablecoin flow must agree before RCXT calls an event a BUY or SELL.</p>
        </div>
        <div className="walletActivityActions">
          <button className={autoScore?'toolButton active':'toolButton'} onClick={toggleAutoScore}>
            {autoScore?'Auto Score On':'Auto Score Off'}
          </button>
          <button className="toolButton" onClick={()=>loadActivity()} disabled={!valid||loading}>
            {loading?'Refreshing…':'Refresh'}
          </button>
        </div>
      </div>

      {!valid ? <div className="activityEmpty">Load a valid wallet to inspect recent activity.</div> : null}
      {error ? <div className="v4Error">{error}</div> : null}

      {valid&&data ? (
        <>
          <div className="activitySummary">
            <div><span>Parsed events</span><b>{data.count||0}</b><small>{data.summary?.classificationCoveragePercent ?? 0}% classified</small></div>
            <div><span>BUY / SELL</span><b><i className="good">{data.summary?.buyCount||0}</i> / <i className="bad">{data.summary?.sellCount||0}</i></b><small>{data.summary?.swapCount||0} swaps</small></div>
            <div><span>SOL spent on buys</span><b>{number(data.summary?.solSpentOnBuys||0,4)} SOL</b></div>
            <div><span>SOL from sells</span><b>{number(data.summary?.solReceivedOnSells||0,4)} SOL</b></div>
            <div><span>Unique traded mints</span><b>{data.summary?.uniqueTradedMints||0}</b></div>
            <div><span>Likely recent buys</span><b className={(data.newBuys?.length||0)>0?'good':''}>{data.newBuys?.length||0}</b></div>
            <div><span>Refresh</span><b>30s</b><small>{lastRefresh?'updated '+new Date(lastRefresh).toLocaleTimeString():'—'}</small></div>
            <button className="toolButton" onClick={scoreRecentBuys} disabled={!data.newBuys?.length}>Score recent buys</button>
          </div>

          {data.newBuys?.length ? (
            <div className="newBuyStrip">
              <span className="newBuyLabel">RECENT BUY DETECTION</span>
              <div className="newBuyGrid">
                {data.newBuys.slice(0,4).map((buy)=> {
                  const mint=buy?.token?.address
                  const score=scores[mint]
                  return (
                    <div className="newBuyCard" key={buy.signature+mint}>
                      <div>
                        <strong>{buy?.token?.symbol||short(mint)}</strong>
                        <span>{buy?.token?.name||short(mint,6)}</span>
                      </div>
                      <small>{buy.solSpent?number(buy.solSpent,4)+' SOL spent':'Token inflow'} · {age(buy.blockTime)}</small>
                      <div className="activityScore">
                        {score?.loading ? <span>Scoring…</span> :
                         score?.score!=null ? <><b>{score.score}/100</b><span>{score.signal} · {score.risk}</span></> :
                         <span>Not scored yet</span>}
                      </div>
                      <div className="activityButtons">
                        <button onClick={()=>scoreMint(mint)} disabled={!mint||score?.loading}>Score</button>
                        <button onClick={()=>mint&&onOpenToken?.({address:mint})} disabled={!mint}>Deep scan</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          <div className="activityList">
            {visibleEvents.length ? visibleEvents.map((event)=> {
              const mint=event?.token?.address||event?.primaryMint
              const change=event?.changes?.find(row=>row.mint===mint)
              return (
                <div className="activityRow" key={event.signature||event.slot}>
                  <span className={'activityType '+typeTone(event.type)}>{event.type}</span>
                  <div className="activityToken">
                    <strong>{event?.token?.symbol||short(mint||'TOKEN')}</strong>
                    <small>{event?.token?.name||short(mint,6)}</small>
                  </div>
                  <div className="activityFlow">
                    <b className={Number(change?.delta||0)>=0?'good':'bad'}>{signed(change?.delta,4)}</b>
                    <small>{signed(event.solDelta,5)} SOL</small>
                  </div>
                  <div className="activityWhen"><span>{age(event.blockTime)}</span><small>{event.failed?'FAILED':'confirmed'}</small></div>
                  <div className="activityRowActions">
                    {mint?<button onClick={()=>onOpenToken?.({address:mint})}>Scan</button>:null}
                    {event.signature?<a href={'https://solscan.io/tx/'+event.signature} target="_blank" rel="noreferrer">Tx ↗</a>:null}
                  </div>
                </div>
              )
            }) : <div className="activityEmpty">No recent token-balance activity was parsed from the sampled transactions.</div>}
          </div>

          <p className="activityNote">{data.classificationNote}</p>
        </>
      ) : null}
    </article>
  )
}
