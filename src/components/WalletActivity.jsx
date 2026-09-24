import React, { useEffect, useMemo, useRef, useState } from 'react'
import { criticalStructureFlags } from '../lib/risk-policy.js'
import { normalizeNotificationPrefs } from '../lib/notification-prefs.js'

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

export default function WalletActivity({walletAddress='',onOpenToken,notificationsEnabled=false,notificationPrefs=null,serverMonitor=null,onToggleServerMonitor=null}){
  const [data,setData]=useState(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [scores,setScores]=useState({})
  const [autoScore,setAutoScore]=useState(false)
  const [lastRefresh,setLastRefresh]=useState(null)
  const scoringRef=useRef(new Set())
  const seenBuyRef=useRef(new Set())
  const initializedBuyMonitorRef=useRef(false)
  const activityRequestRef=useRef(0)
  const prefs=normalizeNotificationPrefs(notificationPrefs||serverMonitor?.preferences||{})
  const prefsRef=useRef(prefs)
  const serverMonitorEnabledRef=useRef(Boolean(serverMonitor?.enabled))

  useEffect(()=>{
    prefsRef.current=prefs
    serverMonitorEnabledRef.current=Boolean(serverMonitor?.enabled)
  },[prefs,serverMonitor?.enabled])

  function canNotify(){
    return Boolean(
      notificationsEnabled &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    )
  }

  async function showAlert(title,body,{tag,url,critical=false}={}){
    if(!canNotify()||serverMonitorEnabledRef.current) return
    try{
      const registration=await navigator.serviceWorker?.ready
      if(!registration?.showNotification) return
      await registration.showNotification(title,{
        body,
        icon:'/icon.svg',
        badge:'/icon.svg',
        tag:tag||'rcxt-wallet-alert',
        renotify:Boolean(critical),
        requireInteraction:Boolean(critical),
        data:{url:url||'/'},
      })
    }catch{}
  }

  function readStoredSet(key){
    try{
      const value=JSON.parse(localStorage.getItem(key)||'[]')
      return new Set(Array.isArray(value)?value:[])
    }catch{
      return new Set()
    }
  }

  function writeStoredSet(key,set,max=80){
    try{
      localStorage.setItem(key,JSON.stringify([...set].slice(-max)))
    }catch{}
  }

  function rugAssessment(scan){
    const rugFlags=criticalStructureFlags(scan)
    const severe=scan?.intelligence?.risk==='EXTREME'||scan?.intelligence?.signal==='SELL / AVOID'
    return {rugFlags,severe}
  }

  function shortFlag(flag){
    return String(flag||'')
      .replaceAll('_',' ')
      .toLowerCase()
      .replace(/^./,char=>char.toUpperCase())
  }

  const address=String(walletAddress||'').trim()
  const valid=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)

  useEffect(()=>{
    const saved=localStorage.getItem('rcxt-activity-auto-score-v1')
    const enabled=saved===null ? true : saved==='enabled'
    setAutoScore(enabled)
    if(saved===null) localStorage.setItem('rcxt-activity-auto-score-v1','enabled')
  },[])

  async function loadActivity({silent=false}={}){
    if(!valid) return
    const requestId=++activityRequestRef.current
    const requestAddress=address
    if(!silent) setLoading(true)
    setError('')
    try{
      const response=await fetch('/api/activity?address='+encodeURIComponent(address)+'&limit=15',{cache:'no-store'})
      const json=await response.json()
      if(!response.ok||!json?.success) throw new Error(json?.error||'Wallet activity unavailable')
      if(requestId!==activityRequestRef.current||requestAddress!==address) return
      setData(json)
      setLastRefresh(Date.now())

      const buys=Array.isArray(json?.newBuys)?json.newBuys:[]
      const nextSeen=new Set(buys.map(item=>item?.signature).filter(Boolean))
      const alreadyNotified=readStoredSet('rcxt-buy-alerted-v1')
      const now=Date.now()

      const freshBuys=buys.filter(buy=>{
        const signature=buy?.signature
        if(!signature||alreadyNotified.has(signature)) return false
        const time=new Date(buy?.blockTime||0).getTime()
        const recent=time>0 && now-time<=3*60*1000
        if(!initializedBuyMonitorRef.current) return recent
        return !seenBuyRef.current.has(signature)
      })

      seenBuyRef.current=nextSeen
      initializedBuyMonitorRef.current=true

      for(const buy of freshBuys.slice(0,3)){
        alreadyNotified.add(buy.signature)
        const mint=buy?.token?.address
        if(mint){
          scoreMint(mint,{buy,notifyOnComplete:!serverMonitorEnabledRef.current,force:true})
        }else if(prefsRef.current.newBuy&&!serverMonitorEnabledRef.current){
          showAlert(
            'RCXT detected a new token buy',
            buy?.solSpent ? number(buy.solSpent,4)+' SOL spent · token scan unavailable' : 'Token inflow detected · scan unavailable',
            {tag:'buy-'+buy.signature}
          )
        }
      }
      writeStoredSet('rcxt-buy-alerted-v1',alreadyNotified)
    }catch(err){
      if(requestId===activityRequestRef.current) setError(err?.message||'Wallet activity unavailable')
    }finally{
      if(!silent&&requestId===activityRequestRef.current) setLoading(false)
    }
  }

  useEffect(()=>{
    if(!valid){
      setData(null)
      return
    }
    loadActivity()
    const timer=setInterval(()=>loadActivity({silent:true}),15000)
    return()=>clearInterval(timer)
  },[address])

  useEffect(()=>{
    seenBuyRef.current=new Set()
    initializedBuyMonitorRef.current=false
  },[address])

  async function scoreMint(mint,{buy=null,notifyOnComplete=false,force=false}={}){
    if(!mint||scoringRef.current.has(mint)) return
    const existing=scores[mint]
    if(!force&&existing?.updatedAt&&Date.now()-existing.updatedAt<60000) return

    scoringRef.current.add(mint)
    setScores(current=>({...current,[mint]:{...(current[mint]||{}),loading:true}}))
    try{
      const response=await fetch('/api/scan?address='+encodeURIComponent(mint)+'&persist=0',{cache:'no-store'})
      const json=await response.json()
      if(!response.ok||!json?.success) throw new Error(json?.error||'Score unavailable')

      const next={
        loading:false,
        score:json.scan?.intelligence?.score,
        signal:json.scan?.intelligence?.signal,
        risk:json.scan?.intelligence?.risk,
        opportunityScore:json.scan?.intelligence?.opportunityScore??json.scan?.intelligence?.setupScore,
        riskFlags:json.scan?.intelligence?.riskFlags||[],
        updatedAt:Date.now(),
      }
      setScores(current=>({...current,[mint]:next}))

      const symbol=json.scan?.token?.symbol||buy?.token?.symbol||short(mint)
      const assessment=rugAssessment(json.scan)
      const riskFingerprint=[
        json.scan?.intelligence?.risk,
        json.scan?.intelligence?.signal,
        ...assessment.rugFlags,
      ].join('|')
      const storedRisks=readStoredSet('rcxt-risk-alerted-v1')
      const riskKey=mint+':'+riskFingerprint
      const url='/?token='+encodeURIComponent(mint)+'&chain=solana'

      const activePrefs=prefsRef.current
      const hotButRisky=Number(next.opportunityScore||0)>=60&&['HIGH','EXTREME'].includes(next.risk)
      if(assessment.rugFlags.length&&activePrefs.rugRisk){
        if(!storedRisks.has(riskKey)){
          storedRisks.add(riskKey)
          writeStoredSet('rcxt-risk-alerted-v1',storedRisks,120)
          await showAlert(
            'RCXT RUG RISK: '+symbol,
            'RCXT '+next.score+'/100 · '+next.signal+' · '+assessment.rugFlags.slice(0,2).map(shortFlag).join(' · '),
            {tag:'rug-'+mint,url,critical:true}
          )
        }
      }else if(hotButRisky&&activePrefs.hotMomentumBuy){
        await showAlert(
          'RCXT HOT / HIGH RISK: '+symbol,
          'Opportunity '+next.opportunityScore+'/100 · RCXT '+next.score+'/100 · '+next.risk+' risk',
          {tag:'hot-'+mint,url}
        )
      }else if(assessment.severe&&activePrefs.highRiskBuy){
        if(!storedRisks.has(riskKey)){
          storedRisks.add(riskKey)
          writeStoredSet('rcxt-risk-alerted-v1',storedRisks,120)
          await showAlert(
            'RCXT high-risk buy: '+symbol,
            'RCXT '+next.score+'/100 · '+next.signal+' · '+next.risk+' risk',
            {tag:'risk-'+mint,url}
          )
        }
      }else if(notifyOnComplete&&activePrefs.newBuy){
        const spent=buy?.solSpent?number(buy.solSpent,4)+' SOL · ':''
        await showAlert(
          'RCXT buy detected: '+symbol,
          spent+'RCXT '+next.score+'/100 · opportunity '+(next.opportunityScore??'—')+'/100 · '+next.signal,
          {tag:'buy-'+mint,url}
        )
      }
    }catch(err){
      setScores(current=>({...current,[mint]:{loading:false,error:err?.message||'Score unavailable',updatedAt:Date.now()}}))
      if(notifyOnComplete&&prefsRef.current.newBuy&&!serverMonitorEnabledRef.current){
        const symbol=buy?.token?.symbol||short(mint)
        await showAlert(
          'RCXT buy detected: '+symbol,
          'New buy detected, but the first risk scan could not complete. RCXT will retry.',
          {tag:'buy-pending-'+mint,url:'/?token='+encodeURIComponent(mint)+'&chain=solana'}
        )
      }
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
          <p>RCXT checks this wallet about every 15 seconds while the app is open. When 24/7 Live Monitor is active, background push handles buy alerts so the open app does not send a duplicate copy.</p>
        </div>
        <div className="walletActivityActions">
          <button
            className={serverMonitor?.enabled ? 'monitorMiniToggle active' : 'monitorMiniToggle inactive'}
            onClick={()=>onToggleServerMonitor?.()}
            disabled={Boolean(serverMonitor?.loading)}
          >
            <i />
            {serverMonitor?.loading ? 'Checking…' : serverMonitor?.enabled ? '24/7 ACTIVE' : '24/7 OFF'}
          </button>
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
            <div><span>Open-app refresh</span><b>15s</b><small>{lastRefresh?'updated '+new Date(lastRefresh).toLocaleTimeString():'—'}</small></div>
            <div><span>Background</span><b className={serverMonitor?.enabled?'good':'bad'}>{serverMonitor?.enabled?'ACTIVE':'OFF'}</b><small>{serverMonitor?.enabled?'~30s server checks':'no closed-app checks'}</small></div>
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
