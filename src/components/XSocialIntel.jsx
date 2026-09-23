import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeNotificationPrefs } from '../lib/notification-prefs.js'

function compact(value) {
  const number = Number(value || 0)
  return Intl.NumberFormat('en', { notation:'compact', maximumFractionDigits:1 }).format(number)
}

function percent(value) {
  return Math.round(Number(value || 0) * 100) + '%'
}

function ageLabel(timestamp) {
  const time = new Date(timestamp || 0).getTime()
  if (!Number.isFinite(time) || !time) return '—'
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000))
  if (minutes < 60) return minutes + 'm ago'
  const hours = Math.round(minutes / 60)
  if (hours < 48) return hours + 'h ago'
  return Math.round(hours / 24) + 'd ago'
}

function signalTone(signal) {
  if (signal === 'IGNITING' || signal === 'BUILDING') return 'good'
  if (signal === 'SHILL-HEAVY' || signal === 'NEGATIVE PRESSURE') return 'bad'
  return 'mid'
}

function Metric({ label, value, detail, tone = '' }) {
  return (
    <div className="xMetric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

export default function XSocialIntel({ scan, notificationsEnabled=false, notificationPrefs=null }) {
  const address = String(scan?.address || '')
  const symbol = String(scan?.token?.symbol || '')
  const name = String(scan?.token?.name || '')
  const scanRef = useRef(scan)

  const [social, setSocial] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [aiReport, setAiReport] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(null)
  const prefs=normalizeNotificationPrefs(notificationPrefs||{})

  async function maybeNotifyX(nextSocial){
    if(!prefs.xMomentum||!notificationsEnabled||typeof Notification==='undefined'||Notification.permission!=='granted') return
    const signal=String(nextSocial?.signal||'')
    if(!['IGNITING','NEGATIVE PRESSURE','SHILL-HEAVY'].includes(signal)) return

    const key=address+':'+signal
    try{
      const now=Date.now()
      const stored=JSON.parse(localStorage.getItem('rcxt-x-alert-dedupe-v1')||'{}')
      const previous=Number(stored?.[key]||0)
      const cooldown=Math.max(1,Number(prefs.cooldownMinutes||20))*60_000
      if(previous&&now-previous<cooldown) return
      stored[key]=now
      localStorage.setItem('rcxt-x-alert-dedupe-v1',JSON.stringify(stored))

      const registration=await navigator.serviceWorker?.ready
      if(!registration?.showNotification) return
      const title=signal==='IGNITING'
        ? 'RCXT X momentum: '+(symbol||name||'Token')
        : 'RCXT X quality warning: '+(symbol||name||'Token')
      const detail=signal==='IGNITING'
        ? 'Momentum '+Number(nextSocial?.momentumScore||0)+'/100 · '+Number(nextSocial?.accelerationRatio||0).toFixed(1)+'× acceleration'
        : signal+' · shill risk '+String(nextSocial?.shillRisk||'UNKNOWN')
      await registration.showNotification(title,{
        body:detail,
        icon:'/icon.svg',
        badge:'/icon.svg',
        tag:'x-'+address,
        renotify:false,
        data:{url:'/?token='+encodeURIComponent(address)},
      })
    }catch{}
  }

  useEffect(() => {
    scanRef.current = scan
  }, [scan])

  const runAiReport = useCallback(async (nextSocial) => {
    if (!nextSocial?.available || !scanRef.current) return
    setAiLoading(true)
    try {
      const response = await fetch('/api/ai', {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body:JSON.stringify({
          scan:scanRef.current,
          social:nextSocial,
          mode:'social',
          marketContext:null,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data?.success) throw new Error(data?.error || 'X AI report failed')
      setAiReport(data.analysis || '')
      setAiModel(data.model || '')
    } catch (nextError) {
      setAiReport('')
      setAiModel('')
      setError(nextError?.message || 'X AI report failed')
    } finally {
      setAiLoading(false)
    }
  }, [])

  const loadSocial = useCallback(async (withAi = false) => {
    if (!address && !symbol && !name) return
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        address,
        symbol,
        name,
        persist:'1',
      })
      const response = await fetch('/api/social?' + params.toString(), { cache:'no-store' })
      const data = await response.json()
      if (!response.ok || !data?.success) throw new Error(data?.error || 'X search failed')
      setSocial(data.social)
      setLastRefresh(data.scannedAt || new Date().toISOString())
      if(data.social?.available) await maybeNotifyX(data.social)
      if (withAi && data.social?.available) await runAiReport(data.social)
    } catch (nextError) {
      setError(nextError?.message || 'X search failed')
    } finally {
      setLoading(false)
    }
  }, [address, symbol, name, runAiReport, notificationsEnabled, notificationPrefs])

  useEffect(() => {
    setSocial(null)
    setAiReport('')
    setAiModel('')
    setError('')
    loadSocial(true)

    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') loadSocial(false)
    }, 60_000)

    return () => clearInterval(timer)
  }, [address, symbol, name, loadSocial])

  const x = social?.x || social?.providers?.[0] || null
  const xReason = String(x?.reason || '')
  const xProjectSetupError = /attached to a Project|developer App.*Project/i.test(xReason)
  const xCredentialMissing = /not configured|missing.*bearer|X_BEARER_TOKEN/i.test(xReason)
  const topPosts = Array.isArray(x?.posts) ? x.posts.slice(0, 6) : []
  const narratives = Array.isArray(x?.narratives) ? x.narratives.slice(0, 8) : []
  const catalysts = Array.isArray(x?.catalysts) ? x.catalysts.slice(0, 5) : []
  const riskClaims = Array.isArray(x?.riskClaims) ? x.riskClaims.slice(0, 5) : []

  const searchLabel = useMemo(() => {
    if (!x) return 'X SEARCH'
    return x.searchMode === 'full-archive' ? 'FULL ARCHIVE' : 'RECENT 7D'
  }, [x])

  if (!social && loading) {
    return (
      <article className="panel xIntelPanel">
        <div className="xIntelLoading">
          <span>V5 X INTELLIGENCE</span>
          <strong>Searching X…</strong>
          <small>Name · ticker · contract address</small>
        </div>
      </article>
    )
  }

  if (social && !social.available) {
    const offlineTitle = xProjectSetupError
      ? 'X connection reached — Developer Project setup needed'
      : xCredentialMissing
        ? 'X feed reporting is built — connection needed'
        : 'X feed is temporarily unavailable'

    const offlineBody = xProjectSetupError
      ? 'RCXT reached the official X API with your bearer token, but X rejected search access because the Developer App is not attached to an X Developer Project.'
      : xCredentialMissing
        ? 'RCXT is ready to search the coin name, ticker and contract address through the official X API, but the server does not currently have a usable bearer token.'
        : 'RCXT could not complete the X search right now. The scanner and on-chain intelligence still work normally.'

    const setupLabel = xProjectSetupError
      ? 'ATTACH APP TO X PROJECT'
      : xCredentialMissing
        ? 'X_BEARER_TOKEN'
        : 'RETRY X CONNECTION'

    return (
      <article className="panel xIntelPanel offline">
        <div className="xIntelHead">
          <div>
            <span>V5 X INTELLIGENCE</span>
            <h3>{offlineTitle}</h3>
            <p>{offlineBody}</p>
          </div>
          <div className="xSignalBadge offline">X OFFLINE</div>
        </div>
        <div className="xConnectCard">
          <b>{xProjectSetupError ? 'X DEVELOPER SETUP' : xCredentialMissing ? 'REQUIRED SECRET' : 'CONNECTION STATUS'}</b>
          <strong>{setupLabel}</strong>
          <span>
            {xProjectSetupError
              ? 'Your token is being recognized. The remaining fix is inside the X Developer Console, not Vercel.'
              : xCredentialMissing
                ? 'Add the bearer token as a server-side Vercel environment variable.'
                : 'Retry the connection. If the problem continues, check the X developer app status.'}
          </span>
          {xReason ? (
            <details className="xTechnicalDetails">
              <summary>Technical details</summary>
              <span>{xReason}</span>
            </details>
          ) : null}
        </div>
        <div className="xIntelFoot">
          <span>No Reddit. No Instagram. X only.</span>
          <button className="toolButton" onClick={() => loadSocial(true)} disabled={loading}>Retry X connection</button>
        </div>
      </article>
    )
  }

  if (!social?.available) return null

  return (
    <article className="panel xIntelPanel">
      <div className="xIntelHead">
        <div>
          <span>V5 X INTELLIGENCE · {searchLabel}</span>
          <h3>X feed report for {'$' + (symbol || 'TOKEN')}</h3>
          <p>
            RCXT searches the token name, ticker and contract address, then separates real conversation
            from duplicate/shill-heavy activity. X claims are treated as unverified until confirmed elsewhere.
          </p>
        </div>
        <div className={'xSignalBadge ' + signalTone(social.signal)}>
          <small>X PULSE</small>
          <strong>{social.signal || 'MIXED'}</strong>
          <span>{social.momentumScore || 0}/100</span>
        </div>
      </div>

      <div className="xMetricGrid">
        <Metric label="MENTIONS" value={social.mentionCount || 0} detail={(social.windows?.h1 || 0) + ' in last 1h'} />
        <Metric label="AUTHORS" value={social.uniqueAuthors || 0} detail={(social.largeAccountMentions || 0) + ' large-account posts'} />
        <Metric label="ENGAGEMENT" value={compact(social.engagement)} detail={compact(social.impressions) + ' impressions reported'} />
        <Metric
          label="SENTIMENT"
          value={x?.sentimentLabel || 'NEUTRAL'}
          detail={'score ' + Number(social.sentiment || 0).toFixed(2)}
          tone={Number(social.sentiment || 0) > 0.1 ? 'good' : Number(social.sentiment || 0) < -0.1 ? 'bad' : 'mid'}
        />
        <Metric label="ORGANIC" value={(social.organicScore || 0) + '/100'} detail={'shill risk ' + (social.shillRisk || 'LOW')} />
        <Metric label="ACCELERATION" value={Number(social.accelerationRatio || 0).toFixed(1) + '×'} detail="1h rate vs prior 2h" />
      </div>

      <div className="xWindowStrip">
        <div><span>15M</span><b>{social.windows?.m15 || 0}</b></div>
        <div><span>1H</span><b>{social.windows?.h1 || 0}</b></div>
        <div><span>3H</span><b>{social.windows?.h3 || 0}</b></div>
        <div><span>24H</span><b>{social.windows?.h24 || 0}</b></div>
        <div><span>QUALITY</span><b>{social.qualityScore || 0}/100</b></div>
        <div><span>DUPLICATES</span><b>{percent(social.duplicateRatio)}</b></div>
      </div>

      <div className="xIntelColumns">
        <div className="xNarrativeCard">
          <div className="xSectionTitle"><span>NARRATIVE MAP</span><small>Most repeated relevant terms</small></div>
          <div className="xChipCloud">
            {narratives.length ? narratives.map((item) => (
              <span key={item.term}>{item.term}<b>{item.weight}</b></span>
            )) : <em>No strong narrative cluster yet.</em>}
          </div>

          <div className="xClaimGrid">
            <div>
              <span>CATALYST CHATTER</span>
              {catalysts.length ? catalysts.map((item) => <p key={item.term}><b>{item.count}×</b>{item.term}</p>) : <small>None detected.</small>}
            </div>
            <div>
              <span>RISK CLAIMS ON X</span>
              {riskClaims.length ? riskClaims.map((item) => <p key={item.term}><b>{item.count}×</b>{item.term}</p>) : <small>No repeated risk claims detected.</small>}
            </div>
          </div>
        </div>

        <div className="xAiCard">
          <div className="xSectionTitle">
            <span>RCXT X AI REPORT</span>
            <button onClick={() => runAiReport(social)} disabled={aiLoading}>
              {aiLoading ? 'Analyzing…' : aiReport ? 'Refresh AI' : 'Run AI'}
            </button>
          </div>
          {aiReport ? (
            <>
              <pre>{aiReport}</pre>
              <small>{aiModel ? 'Model: ' + aiModel : 'AI report'} · Social data is supporting evidence, not proof.</small>
            </>
          ) : (
            <div className="xAiEmpty">
              <strong>{aiLoading ? 'Reading X feed…' : 'AI report not generated yet'}</strong>
              <span>RCXT will summarize momentum, narratives, account quality, contradictions and shill risk.</span>
            </div>
          )}
        </div>
      </div>

      <div className="xTopPosts">
        <div className="xSectionTitle">
          <span>HIGH-IMPACT X POSTS</span>
          <small>{x?.verifiedMentions || 0} verified · {x?.largeAccountMentions || 0} from 10K+ follower accounts</small>
        </div>
        {topPosts.length ? (
          <div className="xPostGrid">
            {topPosts.map((post) => (
              <a key={post.id || post.url} href={post.url || '#'} target="_blank" rel="noreferrer">
                <div className="xPostAuthor">
                  <strong>@{post.author?.username || 'unknown'}</strong>
                  {post.author?.verified ? <i>VERIFIED</i> : null}
                  <span>{compact(post.author?.followers)} followers</span>
                </div>
                <p>{String(post.text || '').replace(/\s+/g, ' ').slice(0, 240)}</p>
                <small>{compact(post.engagement)} engagement · {ageLabel(post.timestamp)} · impact {post.impactScore || 0}</small>
              </a>
            ))}
          </div>
        ) : (
          <div className="xNoPosts">No relevant posts matched strongly enough yet.</div>
        )}
      </div>

      <div className="xIntelFoot">
        <span>
          Auto-refresh ~60s while this scanner is visible · {x?.rawResultCount || 0} raw results checked ·
          {' '}latest relevant post {ageLabel(x?.latestAt)}
        </span>
        <button className="toolButton" onClick={() => loadSocial(true)} disabled={loading || aiLoading}>
          {loading ? 'Searching…' : 'Refresh X + AI'}
        </button>
      </div>

      {lastRefresh ? <small className="xLastRefresh">Last X scan {new Date(lastRefresh).toLocaleTimeString()}</small> : null}
      {error ? <div className="xIntelError">{error}</div> : null}
    </article>
  )
}
