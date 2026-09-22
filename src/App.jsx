'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'

const TEST_WALLET = '976CYJJEVhntZhKS5wdUb3mz2w8FxViDbfCWK8xg2eQ7'
const HISTORY_KEY = 'rcxt-scan-history-v1'
const HIDDEN_KEY = 'rcxt-hidden-coins-v1'
const NOTIFY_KEY = 'rcxt-notifications-v1'
const WATCH_KEY = 'rcxt-watchlist-v1'
const RULES_KEY = 'rcxt-alert-rules-v1'
const NOTES_KEY = 'rcxt-token-notes-v1'

export default function Home() {
  const [view, setView] = useState('radar')
  const [radar, setRadar] = useState([])
  const [radarLoading, setRadarLoading] = useState(true)
  const [radarError, setRadarError] = useState('')

  const [tokenAddress, setTokenAddress] = useState('')
  const [scan, setScan] = useState(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)

  const [aiAnalysis, setAiAnalysis] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const [wallet, setWallet] = useState(TEST_WALLET)
  const [walletData, setWalletData] = useState(null)
  const [walletLoading, setWalletLoading] = useState(false)
  const [walletError, setWalletError] = useState('')

  const [history, setHistory] = useState([])
  const [hiddenCoins, setHiddenCoins] = useState([])
  const [showHidden, setShowHidden] = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [notificationStatus, setNotificationStatus] = useState('')
  const [watchlist, setWatchlist] = useState([])
  const [showWatchlist, setShowWatchlist] = useState(false)
  const [compare, setCompare] = useState([])
  const [radarSearch, setRadarSearch] = useState('')
  const [radarSort, setRadarSort] = useState('score')
  const [signalFilter, setSignalFilter] = useState('ALL')
  const [minScore, setMinScore] = useState(0)
  const [minLiquidity, setMinLiquidity] = useState(0)
  const [positionSize, setPositionSize] = useState('50')
  const [targetMarketCap, setTargetMarketCap] = useState('')
  const [health, setHealth] = useState(null)
  const [alertScore, setAlertScore] = useState(75)
  const [alertMarketCap, setAlertMarketCap] = useState('')
  const [alertSignalChanges, setAlertSignalChanges] = useState(true)
  const [tokenNote, setTokenNote] = useState('')
  const [scoreHistory, setScoreHistory] = useState([])
  const [socialIntel, setSocialIntel] = useState(null)
  const [socialLoading, setSocialLoading] = useState(false)
  const [socialError, setSocialError] = useState('')
  const [socialLastRefresh, setSocialLastRefresh] = useState(null)
  const [calibration, setCalibration] = useState({ totalSamples: 0, rows: [] })

  const loadRadar = useCallback(async () => {
    setRadarLoading(true)
    setRadarError('')

    try {
      const response = await fetch('/api/radar', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Radar failed')
      const nextItems = data.items || []
      setRadar((previous) => {
        maybeNotifyRadarChanges(previous, nextItems)
        return nextItems
      })
    } catch (error) {
      setRadarError(error.message)
    } finally {
      setRadarLoading(false)
    }
  }, [notificationsEnabled])

  useEffect(() => {
    loadRadar()

    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
      if (Array.isArray(saved)) setHistory(saved.slice(0, 12))

      const hidden = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')
      if (Array.isArray(hidden)) setHiddenCoins(hidden.filter((item) => item?.address))

      const notifySaved = localStorage.getItem(NOTIFY_KEY) === 'enabled'
      setNotificationsEnabled(notifySaved && typeof Notification !== 'undefined' && Notification.permission === 'granted')

      const savedWatchlist = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]')
      if (Array.isArray(savedWatchlist)) setWatchlist(savedWatchlist.filter((item) => item?.address).slice(0, 50))

      const savedRules = JSON.parse(localStorage.getItem(RULES_KEY) || '{}')
      if (Number.isFinite(Number(savedRules.score))) setAlertScore(Number(savedRules.score))
      if (savedRules.marketCap != null) setAlertMarketCap(String(savedRules.marketCap))
      if (typeof savedRules.signalChanges === 'boolean') setAlertSignalChanges(savedRules.signalChanges)
    } catch {
      // Ignore malformed local history.
    }
  }, [loadRadar])

  useEffect(() => {
    let active = true

    async function loadHealth() {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' })
        const data = await response.json()
        if (active && data?.success) setHealth(data)
      } catch {
        if (active) setHealth({ healthy: false, services: {} })
      }
    }

    loadHealth()
    const timer = setInterval(loadHealth, 30000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadCalibration() {
      try {
        const response = await fetch('/api/calibration', { cache: 'no-store' })
        const data = await response.json()
        if (active && response.ok && data?.success) {
          setCalibration({ totalSamples: data.totalSamples || 0, rows: data.rows || [] })
        }
      } catch {}
    }

    loadCalibration()
    const timer = setInterval(loadCalibration, 300000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (view !== 'radar') return

    const timer = setInterval(() => {
      loadRadar()
    }, 10000)

    return () => clearInterval(timer)
  }, [view, loadRadar])

  const loadSocial = useCallback(async ({ targetScan, silent = false } = {}) => {
    if (!targetScan?.address) return
    if (!silent) setSocialLoading(true)
    setSocialError('')

    try {
      const params = new URLSearchParams({
        address: targetScan.address,
        symbol: targetScan.token?.symbol || '',
        name: targetScan.token?.name || '',
        persist: silent ? '0' : '1',
      })
      const response = await fetch(`/api/social?${params.toString()}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Social scan failed')
      setSocialIntel(data.social)
      setSocialLastRefresh(new Date())
    } catch (error) {
      if (!silent) setSocialIntel(null)
      setSocialError(error.message)
    } finally {
      if (!silent) setSocialLoading(false)
    }
  }, [])

  const runScan = useCallback(async ({ address, silent = false } = {}) => {
    const target = String(address ?? tokenAddress).trim()
    if (!target) return

    if (!silent) {
      setScanLoading(true)
      setAiAnalysis('')
      setAiModel('')
    }

    setScanError('')

    try {
      const persist = silent ? '0' : '1'
      const response = await fetch(`/api/scan?address=${encodeURIComponent(target)}&persist=${persist}`, {
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Scan failed')

      setTokenAddress(target)
      setScan((previous) => {
        if (silent && previous?.address === data.scan.address) {
          maybeNotifySignalChange(previous, data.scan)
          maybeNotifyRuleCrossings(previous, data.scan)
        }
        return data.scan
      })
      setLastRefresh(new Date())

      try {
        const notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}')
        setTokenNote(notes[data.scan.address] || '')
      } catch {
        setTokenNote('')
      }

      if (!silent) {
        loadSocial({ targetScan: data.scan })

        try {
          const historyResponse = await fetch(`/api/history?address=${encodeURIComponent(target)}`, { cache: 'no-store' })
          const historyData = await historyResponse.json()
          if (historyResponse.ok && historyData?.success) setScoreHistory(historyData.rows || [])
        } catch {
          setScoreHistory([])
        }

        const entry = {
          address: data.scan.address,
          symbol: data.scan.token.symbol,
          name: data.scan.token.name,
          score: data.scan.intelligence.score,
          signal: data.scan.intelligence.signal,
          time: Date.now(),
        }

        setHistory((current) => {
          const next = [
            entry,
            ...current.filter((item) => item.address !== entry.address),
          ].slice(0, 12)

          localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
          return next
        })
      }
    } catch (error) {
      setScanError(error.message)
      if (!silent) setScan(null)
    } finally {
      if (!silent) setScanLoading(false)
    }
  }, [tokenAddress, notificationsEnabled, alertScore, alertMarketCap, alertSignalChanges, loadSocial])

  useEffect(() => {
    const deepLinkedToken = new URLSearchParams(window.location.search).get('token')
    if (!deepLinkedToken) return
    setView('scanner')
    setTokenAddress(deepLinkedToken)
    runScan({ address: deepLinkedToken })
  }, [])

  useEffect(() => {
    if (!autoRefresh || !scan?.address) return

    const timer = setInterval(() => {
      runScan({ address: scan.address, silent: true })
    }, 5000)

    return () => clearInterval(timer)
  }, [autoRefresh, scan?.address, runScan])

  useEffect(() => {
    if (!scan?.address) return
    const timer = setInterval(() => {
      loadSocial({ targetScan: scan, silent: true })
    }, 60000)
    return () => clearInterval(timer)
  }, [scan?.address, loadSocial])

  async function enableNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationStatus('Notifications are not supported in this browser.')
      return
    }

    try {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        localStorage.setItem(NOTIFY_KEY, 'enabled')
        setNotificationsEnabled(true)
        setNotificationStatus('Notifications enabled.')
        const registration = await navigator.serviceWorker?.ready
        if (registration?.showNotification) {
          registration.showNotification('RCXT Radar', {
            body: 'Signal alerts are enabled on this device.',
            icon: '/icon.svg',
            badge: '/icon.svg',
          })
        }
      } else {
        setNotificationsEnabled(false)
        localStorage.removeItem(NOTIFY_KEY)
        setNotificationStatus('Notification permission was not granted.')
      }
    } catch {
      setNotificationStatus('Could not enable notifications.')
    }
  }

  function disableNotifications() {
    localStorage.removeItem(NOTIFY_KEY)
    setNotificationsEnabled(false)
    setNotificationStatus('Notifications disabled.')
  }

  function maybeNotifySignalChange(previous, next) {
    if (!alertSignalChanges) return
    if (!notificationsEnabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const before = previous?.intelligence?.signal
    const after = next?.intelligence?.signal
    if (!before || !after || before === after) return

    navigator.serviceWorker?.ready.then((registration) => {
      registration.showNotification(`${next.token?.symbol || 'Token'} signal changed`, {
        body: `${before} → ${after} · Score ${next.intelligence?.score ?? '—'}/100`,
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag: `scan-${next.address}`,
      })
    }).catch(() => {})
  }

  function maybeNotifyRadarChanges(previous, next) {
    if (!notificationsEnabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (!Array.isArray(previous) || previous.length === 0) return

    const before = new Map(previous.map((item) => [item.address, item.intelligence?.signal]))
    for (const item of next) {
      const oldSignal = before.get(item.address)
      const newSignal = item.intelligence?.signal
      if (!oldSignal || !newSignal || oldSignal === newSignal) continue
      if (!['BUY SETUP', 'LEAN BUY', 'REDUCE', 'SELL / AVOID'].includes(newSignal)) continue

      navigator.serviceWorker?.ready.then((registration) => {
        registration.showNotification(`${item.symbol || 'Token'}: ${newSignal}`, {
          body: `RCXT score ${item.intelligence?.score ?? '—'}/100 · ${item.intelligence?.risk || 'risk'} risk`,
          icon: '/icon.svg',
          badge: '/icon.svg',
          tag: `radar-${item.address}`,
        })
      }).catch(() => {})
    }
  }

  function maybeNotifyRuleCrossings(previous, next) {
    if (!notificationsEnabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return

    const scoreTarget = Number(alertScore || 0)
    if (
      scoreTarget > 0 &&
      Number(previous?.intelligence?.score || 0) < scoreTarget &&
      Number(next?.intelligence?.score || 0) >= scoreTarget
    ) {
      navigator.serviceWorker?.ready.then((registration) => {
        registration.showNotification(`${next.token?.symbol || 'Token'} crossed score ${scoreTarget}`, {
          body: `RCXT score is now ${next.intelligence?.score}/100 · ${next.intelligence?.signal}`,
          icon: '/icon.svg',
          badge: '/icon.svg',
          tag: `score-${next.address}`,
        })
      }).catch(() => {})
    }

    const marketCapTarget = Number(alertMarketCap || 0)
    if (
      marketCapTarget > 0 &&
      Number(previous?.market?.marketCap || 0) < marketCapTarget &&
      Number(next?.market?.marketCap || 0) >= marketCapTarget
    ) {
      navigator.serviceWorker?.ready.then((registration) => {
        registration.showNotification(`${next.token?.symbol || 'Token'} hit MC target`, {
          body: `Market cap crossed ${compactUsd(marketCapTarget)} · now ${compactUsd(next.market?.marketCap)}`,
          icon: '/icon.svg',
          badge: '/icon.svg',
          tag: `mc-${next.address}`,
        })
      }).catch(() => {})
    }
  }

  function saveAlertRules(next = {}) {
    const rules = {
      score: next.score ?? alertScore,
      marketCap: next.marketCap ?? alertMarketCap,
      signalChanges: next.signalChanges ?? alertSignalChanges,
    }
    localStorage.setItem(RULES_KEY, JSON.stringify(rules))
  }

  function saveTokenNote() {
    if (!scan?.address) return
    try {
      const notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}')
      notes[scan.address] = tokenNote.slice(0, 2000)
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes))
      setNotificationStatus('Token note saved.')
    } catch {
      setNotificationStatus('Could not save token note.')
    }
  }

  async function shareCurrentToken() {
    if (!scan?.address) return
    const url = `${window.location.origin}/?token=${encodeURIComponent(scan.address)}`
    try {
      if (navigator.share) {
        await navigator.share({
          title: `RCXT Radar — ${scan.token?.symbol || 'Token'}`,
          text: `${scan.token?.name || 'Token'} · RCXT ${scan.intelligence?.score ?? '—'}/100 · ${scan.intelligence?.signal || 'WATCH'}`,
          url,
        })
      } else {
        await navigator.clipboard.writeText(url)
        setNotificationStatus('Share link copied.')
      }
    } catch {}
  }

  async function askAI() {
    if (!scan) return

    setAiLoading(true)
    setAiAnalysis('')

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan, social: socialIntel }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'AI analysis failed')
      setAiAnalysis(data.analysis)
      setAiModel(data.model)
    } catch (error) {
      setAiAnalysis(`AI analysis unavailable: ${error.message}`)
      setAiModel('unavailable')
    } finally {
      setAiLoading(false)
    }
  }

  async function loadWallet() {
    const address = wallet.trim()
    if (!address) return

    setWalletLoading(true)
    setWalletError('')

    try {
      const response = await fetch(`/api/wallet?address=${encodeURIComponent(address)}`, {
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Wallet load failed')
      setWalletData(data)
    } catch (error) {
      setWalletError(error.message)
    } finally {
      setWalletLoading(false)
    }
  }

  function openRadarToken(item) {
    setView('scanner')
    setTokenAddress(item.address)
    runScan({ address: item.address })
  }

  function hideCoin(item) {
    setHiddenCoins((current) => {
      const next = [
        { address: item.address, symbol: item.symbol, name: item.name },
        ...current.filter((coin) => coin.address !== item.address),
      ]
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next))
      return next
    })
  }

  function restoreCoin(address) {
    setHiddenCoins((current) => {
      const next = current.filter((coin) => coin.address !== address)
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next))
      return next
    })
  }

  function restoreAllCoins() {
    setHiddenCoins([])
    localStorage.removeItem(HIDDEN_KEY)
  }

  function toggleWatch(item) {
    const address = item?.address || item?.mint
    if (!address) return

    setWatchlist((current) => {
      const exists = current.some((coin) => coin.address === address)
      const next = exists
        ? current.filter((coin) => coin.address !== address)
        : [{
            address,
            symbol: item?.symbol || item?.token?.symbol || 'TOKEN',
            name: item?.name || item?.token?.name || 'Unknown',
            addedAt: Date.now(),
          }, ...current].slice(0, 50)

      localStorage.setItem(WATCH_KEY, JSON.stringify(next))
      return next
    })
  }

  function toggleCompare(item) {
    const address = item?.address || item?.mint
    if (!address) return

    setCompare((current) => {
      if (current.some((coin) => coin.address === address)) {
        return current.filter((coin) => coin.address !== address)
      }
      if (current.length >= 4) {
        setNotificationStatus('Compare supports up to 4 tokens at once.')
        return current
      }
      return [...current, { ...item, address }]
    })
  }

  function exportRadarCsv() {
    const rows = [
      ['symbol','name','address','score','signal','risk','priceUsd','marketCap','liquidityUsd','volume24h','change24h'],
      ...visibleRadar.map((item) => [
        item.symbol,item.name,item.address,item.intelligence?.score,item.intelligence?.signal,item.intelligence?.risk,
        item.priceUsd,item.marketCap,item.liquidityUsd,item.volume24h,item.change24h
      ])
    ]
    downloadCsv('rcxt-radar.csv', rows)
  }

  function exportWalletCsv() {
    if (!walletData?.holdings) return
    const rows = [
      ['symbol','name','mint','balance','priceUsd','valueUsd','change24h','liquidityUsd','score','signal'],
      ['SOL','Solana','native',walletData.solBalance,walletData.solPriceUsd,walletData.solValueUsd,'','','',''],
      ...walletData.holdings.map((item) => [
        item.symbol || '',item.name || '',item.mint,item.balance,item.priceUsd,item.valueUsd,
        item.change24h,item.liquidityUsd,item.intelligence?.score || '',item.intelligence?.signal || ''
      ])
    ]
    downloadCsv('rcxt-wallet.csv', rows)
  }

  const hiddenAddresses = useMemo(
    () => new Set(hiddenCoins.map((coin) => coin.address)),
    [hiddenCoins],
  )

  const watchAddresses = useMemo(
    () => new Set(watchlist.map((coin) => coin.address)),
    [watchlist],
  )

  const visibleRadar = useMemo(() => {
    const query = radarSearch.trim().toLowerCase()
    const filtered = radar.filter((item) => {
      if (hiddenAddresses.has(item.address)) return false
      if (query && !`${item.symbol} ${item.name} ${item.address}`.toLowerCase().includes(query)) return false
      if (signalFilter !== 'ALL' && item.intelligence?.signal !== signalFilter) return false
      if (Number(item.intelligence?.score || 0) < Number(minScore || 0)) return false
      if (Number(item.liquidityUsd || 0) < Number(minLiquidity || 0)) return false
      return true
    })

    const sorters = {
      score: (a,b) => Number(b.intelligence?.score || 0) - Number(a.intelligence?.score || 0),
      volume: (a,b) => Number(b.volume24h || 0) - Number(a.volume24h || 0),
      liquidity: (a,b) => Number(b.liquidityUsd || 0) - Number(a.liquidityUsd || 0),
      momentum: (a,b) => Number(b.change1h || 0) - Number(a.change1h || 0),
      marketCap: (a,b) => Number(b.marketCap || 0) - Number(a.marketCap || 0),
    }
    return [...filtered].sort(sorters[radarSort] || sorters.score)
  }, [radar, hiddenAddresses, radarSearch, signalFilter, minScore, minLiquidity, radarSort])

  const radarPulse = useMemo(() => {
    const items = visibleRadar
    if (!items.length) return { buys:0, highRisk:0, medianScore:0, volume24h:0, avg1h:0 }

    const scores = items.map((item) => Number(item.intelligence?.score || 0)).sort((a,b) => a-b)
    const middle = Math.floor(scores.length / 2)
    const medianScore = scores.length % 2 ? scores[middle] : Math.round((scores[middle - 1] + scores[middle]) / 2)

    return {
      buys: items.filter((item) => ['BUY SETUP','LEAN BUY'].includes(item.intelligence?.signal)).length,
      highRisk: items.filter((item) => ['HIGH','EXTREME'].includes(item.intelligence?.risk)).length,
      medianScore,
      volume24h: items.reduce((sum,item) => sum + Number(item.volume24h || 0), 0),
      avg1h: items.reduce((sum,item) => sum + Number(item.change1h || 0), 0) / items.length,
    }
  }, [visibleRadar])

  const portfolioStats = useMemo(() => {
    const holdings = walletData?.holdings || []
    const total = Number(walletData?.portfolioTokenValueUsd || 0)
    const priced = holdings.filter((item) => Number(item.valueUsd || 0) > 0)
    const largest = priced[0]
    const concentration = total > 0 && largest ? (Number(largest.valueUsd || 0) / total) * 100 : 0
    const highRisk = holdings.filter((item) => ['HIGH','EXTREME'].includes(item.intelligence?.risk)).length
    const liquidValue = holdings
      .filter((item) => Number(item.liquidityUsd || 0) >= 10000)
      .reduce((sum, item) => sum + Number(item.valueUsd || 0), 0)

    return {
      concentration,
      highRisk,
      liquidPercent: total > 0 ? (liquidValue / total) * 100 : 0,
      largestSymbol: largest?.symbol || '—',
    }
  }, [walletData])

  const walletSignals = useMemo(() => {
    if (!walletData?.holdings) return { buy: 0, watch: 0, reduce: 0 }

    return walletData.holdings.reduce(
      (acc, item) => {
        const signal = item?.intelligence?.signal || ''
        if (signal.includes('BUY')) acc.buy += 1
        else if (signal === 'REDUCE' || signal.includes('SELL')) acc.reduce += 1
        else acc.watch += 1
        return acc
      },
      { buy: 0, watch: 0, reduce: 0 },
    )
  }, [walletData])

  return (
    <main className="appShell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('radar')} aria-label="Open radar">
          <span className="brandMark"><i /><i /><i /></span>
          <span>
            <b>RCXT</b>
            <em>RADAR</em>
          </span>
        </button>

        <nav className="desktopNav">
          <NavButton active={view === 'radar'} onClick={() => setView('radar')}>Radar</NavButton>
          <NavButton active={view === 'scanner'} onClick={() => setView('scanner')}>Scanner</NavButton>
          <NavButton active={view === 'wallet'} onClick={() => setView('wallet')}>Wallet</NavButton>
        </nav>

        <div className="topActions">
          <button
            className={notificationsEnabled ? 'notifyButton enabled' : 'notifyButton'}
            onClick={notificationsEnabled ? disableNotifications : enableNotifications}
          >
            {notificationsEnabled ? 'Alerts On' : 'Enable Alerts'}
          </button>
          <div className={health?.healthy === false ? 'systemStatus degraded' : 'systemStatus'}>
            <span className="pulse" />
            <span>{health?.healthy === false ? 'DEGRADED' : 'LIVE'}</span>
            <small>
              {health?.healthy === false
                ? 'Service issue detected'
                : health
                  ? `Solana ${health.services?.solana?.latencyMs ?? '—'}ms · Dex ${health.services?.dexscreener?.latencyMs ?? '—'}ms`
                  : 'Checking systems…'}
            </small>
          </div>
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="overline">MARKET INTELLIGENCE TERMINAL</span>
          <h1>Trade the data.<br /><span>Not the emotion.</span></h1>
          <p>
            Live Solana wallet tracking, contract-risk checks, order-flow analysis,
            deterministic trade signals, and an AI analyst that explains the setup.
          </p>
        </div>

        <div className="heroStatus">
          <div className="orbit">
            <span className="orbitCore">R</span>
            <i className="orbitOne" />
            <i className="orbitTwo" />
          </div>
          <div>
            <strong>RCXT Intelligence</strong>
            <span>6-signal scoring engine</span>
            <small>No mock market data</small>
          </div>
        </div>
      </section>

      {notificationStatus ? (
        <div className="notificationStatus" onClick={() => setNotificationStatus('')}>
          {notificationStatus}
        </div>
      ) : null}

      <div className="mobileNav">
        <NavButton active={view === 'radar'} onClick={() => setView('radar')}>Radar</NavButton>
        <NavButton active={view === 'scanner'} onClick={() => setView('scanner')}>Scanner</NavButton>
        <NavButton active={view === 'wallet'} onClick={() => setView('wallet')}>Wallet</NavButton>
      </div>

      {view === 'radar' && (
        <section className="contentStack">
          <div className="sectionHeading">
            <div>
              <span className="sectionNumber">01</span>
              <div>
                <h2>Opportunity Radar</h2>
                <p>Boosted Solana markets ranked by RCXT signal quality—not by hype.</p>
              </div>
            </div>
            <div className="radarActions">
              {hiddenCoins.length ? (
                <button className="ghostButton" onClick={() => setShowHidden((value) => !value)}>
                  {showHidden ? 'Hide hidden list' : `Hidden (${hiddenCoins.length})`}
                </button>
              ) : null}
              <button className="ghostButton" onClick={loadRadar} disabled={radarLoading}>
                {radarLoading ? 'Refreshing…' : 'Refresh feed'}
              </button>
            </div>
          </div>

          {radarError ? <ErrorBox text={radarError} /> : null}

          <div className="marketPulse">
            <MetricCard label="Buy Setups" value={radarPulse.buys} tone={radarPulse.buys ? 'positive' : ''} />
            <MetricCard label="Median Score" value={radarPulse.medianScore} />
            <MetricCard label="High-Risk Names" value={radarPulse.highRisk} tone={radarPulse.highRisk ? 'negative' : ''} />
            <MetricCard label="Visible 24H Volume" value={compactUsd(radarPulse.volume24h)} />
            <MetricCard label="Avg 1H Momentum" value={percent(radarPulse.avg1h)} tone={radarPulse.avg1h >= 0 ? 'positive' : 'negative'} />
          </div>

          <div className="proToolbar">
            <input
              className="proSearch"
              value={radarSearch}
              onChange={(event) => setRadarSearch(event.target.value)}
              placeholder="Search symbol, name, or CA"
            />
            <select value={radarSort} onChange={(event) => setRadarSort(event.target.value)}>
              <option value="score">Sort: Score</option>
              <option value="volume">Sort: Volume</option>
              <option value="liquidity">Sort: Liquidity</option>
              <option value="momentum">Sort: 1H Momentum</option>
              <option value="marketCap">Sort: Market Cap</option>
            </select>
            <select value={signalFilter} onChange={(event) => setSignalFilter(event.target.value)}>
              <option value="ALL">All signals</option>
              <option value="BUY SETUP">Buy setup</option>
              <option value="LEAN BUY">Lean buy</option>
              <option value="WATCH">Watch</option>
              <option value="REDUCE">Reduce</option>
              <option value="SELL / AVOID">Sell / avoid</option>
            </select>
            <select value={minScore} onChange={(event) => setMinScore(Number(event.target.value))}>
              <option value="0">Any score</option>
              <option value="50">50+ score</option>
              <option value="60">60+ score</option>
              <option value="70">70+ score</option>
              <option value="80">80+ score</option>
            </select>
            <select value={minLiquidity} onChange={(event) => setMinLiquidity(Number(event.target.value))}>
              <option value="0">Any liquidity</option>
              <option value="5000">$5K+ liq</option>
              <option value="15000">$15K+ liq</option>
              <option value="50000">$50K+ liq</option>
              <option value="100000">$100K+ liq</option>
            </select>
            <button className="toolButton" onClick={() => setShowWatchlist((value) => !value)}>
              Watchlist {watchlist.length ? `(${watchlist.length})` : ''}
            </button>
            <button className="toolButton" onClick={exportRadarCsv}>Export CSV</button>
          </div>

          {showWatchlist ? (
            <div className="watchTray">
              <div className="watchTrayHead">
                <div><span>WATCHLIST</span><small>Saved on this device.</small></div>
                <button onClick={() => setShowWatchlist(false)}>Close</button>
              </div>
              {watchlist.length ? (
                <div className="watchGrid">
                  {watchlist.map((coin) => (
                    <button key={coin.address} onClick={() => openRadarToken(coin)}>
                      <strong>{coin.symbol}</strong>
                      <span>{coin.name}</span>
                      <small>{shortAddress(coin.address, 4)}</small>
                    </button>
                  ))}
                </div>
              ) : <p className="trayEmpty">Tap ☆ on a radar card or scanner to save a token.</p>}
            </div>
          ) : null}

          {compare.length ? <CompareTray items={compare} onRemove={toggleCompare} onOpen={openRadarToken} /> : null}

          {showHidden && hiddenCoins.length ? (
            <div className="hiddenTray">
              <div className="hiddenTrayHead">
                <div>
                  <span>HIDDEN COINS</span>
                  <small>These stay hidden on this device until you restore them.</small>
                </div>
                <button onClick={restoreAllCoins}>Restore all</button>
              </div>
              <div className="hiddenCoins">
                {hiddenCoins.map((coin) => (
                  <button key={coin.address} onClick={() => restoreCoin(coin.address)}>
                    <strong>{coin.symbol || 'TOKEN'}</strong>
                    <span>{coin.name || shortAddress(coin.address, 4)}</span>
                    <em>Restore</em>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="radarGrid">
            {radarLoading && radar.length === 0
              ? Array.from({ length: 6 }).map((_, index) => <RadarSkeleton key={index} />)
              : visibleRadar.map((item, index) => (
                <div
                  className="radarCard"
                  key={item.address}
                  role="button"
                  tabIndex={0}
                  onClick={() => openRadarToken(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') openRadarToken(item)
                  }}
                >
                  <div className="radarTop">
                    <span className="rank">#{String(index + 1).padStart(2, '0')}</span>
                    <div className="radarTopActions">
                      <button
                        className={watchAddresses.has(item.address) ? 'watchButton active' : 'watchButton'}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleWatch(item)
                        }}
                        aria-label={watchAddresses.has(item.address) ? `Remove ${item.symbol} from watchlist` : `Watch ${item.symbol}`}
                      >
                        {watchAddresses.has(item.address) ? '★' : '☆'}
                      </button>
                      <button
                        className={compare.some((coin) => coin.address === item.address) ? 'compareButton active' : 'compareButton'}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleCompare(item)
                        }}
                      >
                        Compare
                      </button>
                      <button
                        className="hideCoinButton"
                        onClick={(event) => {
                          event.stopPropagation()
                          hideCoin(item)
                        }}
                        aria-label={`Hide ${item.symbol}`}
                        title="Hide coin"
                      >
                        Hide
                      </button>
                      <SignalBadge signal={item.intelligence.signal} />
                    </div>
                  </div>
                  <div className="tokenName">
                    <strong>{item.symbol}</strong>
                    <span>{item.name}</span>
                  </div>
                  <div className="scoreLine">
                    <ScoreRing score={item.intelligence.score} />
                    <div>
                      <small>RCXT RISK-ADJUSTED SCORE</small>
                      <b>{item.intelligence.grade} · {item.intelligence.confidence}% confidence</b>
                    </div>
                  </div>
                  <ScoreAxes intelligence={item.intelligence} compact />
                  <div className="miniMetrics">
                    <Metric label="MC" value={compactUsd(item.marketCap)} />
                    <Metric label="LIQ" value={compactUsd(item.liquidityUsd)} />
                    <Metric label="24H VOL" value={compactUsd(item.volume24h)} />
                    <Metric
                      label="24H"
                      value={percent(item.change24h)}
                      tone={item.change24h >= 0 ? 'positive' : 'negative'}
                    />
                  </div>
                  <div className="cardFooter">
                    <span>{item.dex || 'DEX'}</span>
                    <span>{item.intelligence.preliminary ? 'Preliminary · full scan →' : 'Open full scan →'}</span>
                  </div>
                </div>
              ))}
          </div>

          <div className="intelStrip">
            <div><span>01</span><b>Liquidity</b><small>Depth + cap ratio</small></div>
            <div><span>02</span><b>Activity</b><small>Volume acceleration</small></div>
            <div><span>03</span><b>Order Flow</b><small>Buy/sell pressure</small></div>
            <div><span>04</span><b>Momentum</b><small>5m → 24h structure</small></div>
            <div><span>05</span><b>Maturity</b><small>Pair-age risk</small></div>
            <div><span>06</span><b>Contract</b><small>Mint + freeze authority</small></div>
          </div>
        </section>
      )}

      {view === 'scanner' && (
        <section className="contentStack">
          <div className="sectionHeading">
            <div>
              <span className="sectionNumber">02</span>
              <div>
                <h2>Deep Token Scanner</h2>
                <p>Paste a Solana CA for a live market, contract, and signal breakdown.</p>
              </div>
            </div>
            <label className="autoToggle">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              <span />
              5S AUTO
            </label>
          </div>

          <div className="scanBar">
            <input
              value={tokenAddress}
              onChange={(event) => setTokenAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') runScan()
              }}
              placeholder="Paste Solana token contract address"
              aria-label="Token contract address"
            />
            <button className="primaryButton" onClick={() => runScan()} disabled={scanLoading}>
              {scanLoading ? 'ANALYZING…' : 'SCAN TOKEN'}
            </button>
          </div>

          {scanError ? <ErrorBox text={scanError} /> : null}

          {scan ? (
            <>
              <div className="scanQuickActions">
                <button className={watchAddresses.has(scan.address) ? 'toolButton active' : 'toolButton'} onClick={() => toggleWatch(scan)}>
                  {watchAddresses.has(scan.address) ? '★ Watching' : '☆ Watch'}
                </button>
                <button className="toolButton" onClick={() => navigator.clipboard?.writeText(scan.address)}>Copy CA</button>
                <button className="toolButton" onClick={shareCurrentToken}>Share</button>
                {scan.pair?.url ? <a className="toolLink" href={scan.pair.url} target="_blank" rel="noreferrer">DexScreener ↗</a> : null}
              </div>

              <div className="scanHero">
                <div className="scanIdentity">
                  <span className="tokenSymbol">{scan.token.symbol}</span>
                  <h3>{scan.token.name}</h3>
                  <button
                    className="addressButton"
                    onClick={() => navigator.clipboard?.writeText(scan.address)}
                  >
                    {shortAddress(scan.address)} · copy
                  </button>
                </div>

                <div className="signalHero">
                  <span>RCXT SIGNAL</span>
                  <SignalBadge signal={scan.intelligence.signal} large />
                  <small>
                    {scan.intelligence.confidence}% confidence · {scan.intelligence.risk} risk
                  </small>
                  <em>{scan.intelligence.preliminary ? 'Preliminary market score' : 'Full contract-verified scan'}</em>
                </div>

                <ScoreRing score={scan.intelligence.score} large />
              </div>

              <article className="scoreModelPanel">
                <div className="scoreModelHead">
                  <div>
                    <span>RCXT SCORE ENGINE {scan.intelligence.modelVersion}</span>
                    <strong>Risk-adjusted setup quality</strong>
                  </div>
                  <small>Not a probability of profit</small>
                </div>
                <ScoreAxes intelligence={scan.intelligence} />
                <ScoreTrend rows={scoreHistory} currentScore={scan.intelligence.score} modelVersion={scan.intelligence.modelVersion} />
                <CalibrationStrip
                  calibration={calibration}
                  modelVersion={scan.intelligence.modelVersion}
                  signal={scan.intelligence.signal}
                />
              </article>

              <div className="metricGrid six">
                <MetricCard label="Price" value={tinyUsd(scan.market.priceUsd)} />
                <MetricCard label="Market Cap" value={compactUsd(scan.market.marketCap)} />
                <MetricCard label="Liquidity" value={compactUsd(scan.market.liquidityUsd)} />
                <MetricCard label="24H Volume" value={compactUsd(scan.market.volume.h24)} />
                <MetricCard
                  label="24H Change"
                  value={percent(scan.market.priceChange.h24)}
                  tone={scan.market.priceChange.h24 >= 0 ? 'positive' : 'negative'}
                />
                <MetricCard label="24H Buy %" value={`${scan.intelligence.buyPercent24h}%`} />
              </div>

              <article className="panel socialIntelPanel">
                <PanelHeader eyebrow="SOCIAL INTELLIGENCE" title="Reddit · X · Instagram" />
                <div className="socialSummary">
                  <MetricCard label="Social Momentum" value={socialIntel?.available ? `${socialIntel.momentumScore}/100` : '—'} />
                  <MetricCard label="Data Quality" value={socialIntel?.available ? `${socialIntel.qualityScore}/100` : '—'} />
                  <MetricCard label="Mentions" value={socialIntel?.available ? socialIntel.mentionCount : '—'} />
                  <MetricCard label="Unique Authors" value={socialIntel?.available ? socialIntel.uniqueAuthors : '—'} />
                  <MetricCard label="Relevance" value={socialIntel?.available ? `${socialIntel.relevanceScore || 0}/100` : '—'} />
                  <MetricCard
                    label="Sentiment"
                    value={socialIntel?.available ? socialSentimentLabel(socialIntel.sentiment) : '—'}
                    tone={Number(socialIntel?.sentiment || 0) > 0.12 ? 'positive' : Number(socialIntel?.sentiment || 0) < -0.12 ? 'negative' : ''}
                  />
                </div>
                <div className="socialProviderGrid">
                  {(socialIntel?.providers || [
                    { source:'reddit', available:false, reason:'Scanning…' },
                    { source:'x', available:false, reason:'Scanning…' },
                    { source:'instagram', available:false, reason:'Scanning…' },
                  ]).map((provider) => (
                    <SocialProviderCard key={provider.source} provider={provider} />
                  ))}
                </div>
                <div className="socialFooter">
                  <span>
                    {socialLoading
                      ? 'Scanning social sources…'
                      : socialLastRefresh
                        ? `Social refreshed ${socialLastRefresh.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })}`
                        : socialError || 'Social scans use official provider adapters when configured.'}
                  </span>
                  <button className="toolButton" onClick={() => loadSocial({ targetScan: scan })} disabled={socialLoading}>
                    {socialLoading ? 'Scanning…' : 'Refresh social'}
                  </button>
                </div>
              </article>

              <div className="analysisGrid">
                <article className="panel scorePanel">
                  <PanelHeader eyebrow="SIGNAL ENGINE" title="Why the score moved" />
                  <ScoreBreakdown breakdown={scan.intelligence.breakdown} />
                </article>

                <article className="panel">
                  <PanelHeader eyebrow="RISK CONTROL" title="Contract + market flags" />
                  <div className="securityRows">
                    <SecurityRow
                      label="Mint authority"
                      good={scan.security?.available && !scan.security?.mintAuthority}
                      unknown={!scan.security?.available}
                      value={
                        !scan.security?.available
                          ? 'Unavailable'
                          : scan.security?.mintAuthority
                            ? 'Active'
                            : 'Disabled'
                      }
                    />
                    <SecurityRow
                      label="Freeze authority"
                      good={scan.security?.available && !scan.security?.freezeAuthority}
                      unknown={!scan.security?.available}
                      value={
                        !scan.security?.available
                          ? 'Unavailable'
                          : scan.security?.freezeAuthority
                            ? 'Active'
                            : 'Disabled'
                      }
                    />
                    <SecurityRow
                      label="Contract verification"
                      good={Boolean(scan.intelligence.contractVerified)}
                      unknown={!scan.security?.available}
                      value={
                        scan.intelligence.contractVerified
                          ? 'Verified'
                          : scan.security?.available
                            ? 'Needs review'
                            : 'Partial'
                      }
                    />
                    <SecurityRow
                      label="Largest account"
                      good={scan.security?.concentrationAvailable && Number(scan.security?.top1Percent || 100) < 45}
                      unknown={!scan.security?.concentrationAvailable}
                      value={
                        scan.security?.concentrationAvailable
                          ? `${Number(scan.security.top1Percent).toFixed(1)}%`
                          : 'Unavailable'
                      }
                    />
                    <SecurityRow
                      label="Top 10 accounts"
                      good={scan.security?.concentrationAvailable && Number(scan.security?.top10Percent || 100) < 85}
                      unknown={!scan.security?.concentrationAvailable}
                      value={
                        scan.security?.concentrationAvailable
                          ? `${Number(scan.security.top10Percent).toFixed(1)}%`
                          : 'Unavailable'
                      }
                    />
                    <SecurityRow
                      label="Liquidity / cap"
                      good={scan.intelligence.liquidityToCapPercent >= 8}
                      value={`${scan.intelligence.liquidityToCapPercent}%`}
                    />
                    <SecurityRow
                      label="Pair age"
                      good={(scan.intelligence.ageHours || 0) >= 24}
                      value={
                        scan.intelligence.ageHours === null
                          ? 'Unknown'
                          : formatAge(scan.intelligence.ageHours)
                      }
                    />
                  </div>
                  <div className="flagWrap">
                    {scan.intelligence.riskFlags.length
                      ? scan.intelligence.riskFlags.map((flag) => (
                          <span className="riskFlag" key={flag}>{flag.replaceAll('_', ' ')}</span>
                        ))
                      : <span className="cleanFlag">NO MAJOR FLAGS DETECTED</span>}
                  </div>
                </article>

                <article className="panel thesisPanel">
                  <PanelHeader eyebrow="TRADE THESIS" title="Bull case vs. invalidation" />
                  <div className="thesisColumns">
                    <div>
                      <span className="thesisLabel positiveText">SUPPORTING</span>
                      {(scan.intelligence.positives.length
                        ? scan.intelligence.positives
                        : ['No strong positive confirmation yet']
                      ).map((item) => <p key={item}><i className="dot good" />{item}</p>)}
                    </div>
                    <div>
                      <span className="thesisLabel negativeText">INVALIDATION</span>
                      {(scan.intelligence.negatives.length
                        ? scan.intelligence.negatives
                        : ['No major invalidation detected in current snapshot']
                      ).map((item) => <p key={item}><i className="dot bad" />{item}</p>)}
                    </div>
                  </div>
                </article>
              </div>

              <div className="proDetailGrid">
                <article className="panel alertPanel">
                  <PanelHeader eyebrow="ALERT ENGINE" title="Rules for this live scanner" />
                  <div className="alertRules">
                    <label>
                      <span>Score crosses</span>
                      <input
                        value={alertScore}
                        onChange={(event) => {
                          const value = Math.max(0, Math.min(100, Number(event.target.value || 0)))
                          setAlertScore(value)
                          saveAlertRules({ score: value })
                        }}
                        type="number"
                        min="0"
                        max="100"
                        inputMode="numeric"
                      />
                    </label>
                    <label>
                      <span>Market cap crosses ($)</span>
                      <input
                        value={alertMarketCap}
                        onChange={(event) => {
                          setAlertMarketCap(event.target.value)
                          saveAlertRules({ marketCap: event.target.value })
                        }}
                        inputMode="decimal"
                        placeholder="100000"
                      />
                    </label>
                    <label className="ruleToggle">
                      <input
                        type="checkbox"
                        checked={alertSignalChanges}
                        onChange={(event) => {
                          setAlertSignalChanges(event.target.checked)
                          saveAlertRules({ signalChanges: event.target.checked })
                        }}
                      />
                      <span>Signal-change alerts</span>
                    </label>
                  </div>
                  <small className="panelHint">Alerts trigger while RCXT Radar is active. Add the PWA to your iPhone Home Screen for the best notification support.</small>
                </article>

                <article className="panel journalPanel">
                  <PanelHeader eyebrow="TRADE JOURNAL" title="Private note for this token" />
                  <textarea
                    value={tokenNote}
                    onChange={(event) => setTokenNote(event.target.value)}
                    placeholder="Catalyst, entry idea, invalidation, what you noticed…"
                    maxLength={2000}
                  />
                  <div className="journalFooter">
                    <span>{tokenNote.length}/2000</span>
                    <button className="toolButton" onClick={saveTokenNote}>Save note</button>
                  </div>
                </article>
              </div>

              <article className="panel calculatorPanel">
                <PanelHeader eyebrow="SCENARIO LAB" title="Market-cap target calculator" />
                <p className="calcNote">A simple scenario calculator. It assumes token price changes proportionally with market cap and ignores slippage, taxes, supply changes, and execution.</p>
                <div className="calculatorGrid">
                  <label>
                    <span>Position size ($)</span>
                    <input value={positionSize} onChange={(event) => setPositionSize(event.target.value)} inputMode="decimal" />
                  </label>
                  <label>
                    <span>Target market cap ($)</span>
                    <input value={targetMarketCap} onChange={(event) => setTargetMarketCap(event.target.value)} inputMode="decimal" placeholder={String(Math.round((scan.market.marketCap || 0) * 2))} />
                  </label>
                  <div className="calcResult">
                    <span>Projected value</span>
                    <strong>{scenarioValue(positionSize, scan.market.marketCap, targetMarketCap)}</strong>
                  </div>
                  <div className="calcResult">
                    <span>Projected P/L</span>
                    <strong>{scenarioProfit(positionSize, scan.market.marketCap, targetMarketCap)}</strong>
                  </div>
                  <div className="calcResult">
                    <span>Target multiple</span>
                    <strong>{scenarioMultiple(scan.market.marketCap, targetMarketCap)}</strong>
                  </div>
                </div>
              </article>

              <article className="panel aiPanel">
                <div className="aiHeader">
                  <div>
                    <span className="aiSpark">✦</span>
                    <div>
                      <span className="eyebrow">RCXT AI ANALYST</span>
                      <h3>Explain this setup</h3>
                    </div>
                  </div>
                  <button className="aiButton" onClick={askAI} disabled={aiLoading}>
                    {aiLoading ? 'THINKING…' : aiAnalysis ? 'REFRESH AI READ' : 'RUN AI ANALYSIS'}
                  </button>
                </div>

                {aiAnalysis ? (
                  <div className="aiResponse">
                    <div className="aiModel">{aiModel}</div>
                    <pre>{aiAnalysis}</pre>
                  </div>
                ) : (
                  <p className="aiEmpty">
                    The deterministic score is already live. Run the AI layer for a second-pass
                    explanation of the signal, contradictions, and invalidation conditions.
                  </p>
                )}
              </article>

              <div className="refreshLine">
                <span className={autoRefresh ? 'pulse' : 'pulse paused'} />
                {autoRefresh ? 'Auto-refreshing every 5 seconds' : 'Auto-refresh paused'}
                {lastRefresh ? <small>Last update {lastRefresh.toLocaleTimeString()}</small> : null}
              </div>
            </>
          ) : (
            <EmptyScanner history={history} onSelect={(item) => runScan({ address: item.address })} />
          )}
        </section>
      )}

      {view === 'wallet' && (
        <section className="contentStack">
          <div className="sectionHeading">
            <div>
              <span className="sectionNumber">03</span>
              <div>
                <h2>Wallet Command Center</h2>
                <p>Live SOL + token holdings with an RCXT signal attached to each liquid market.</p>
              </div>
            </div>
          </div>

          <div className="scanBar">
            <input
              value={wallet}
              onChange={(event) => setWallet(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') loadWallet()
              }}
              placeholder="Paste Solana wallet address"
              aria-label="Solana wallet address"
            />
            <button className="primaryButton" onClick={loadWallet} disabled={walletLoading}>
              {walletLoading ? 'LOADING…' : 'LOAD WALLET'}
            </button>
          </div>

          {walletError ? <ErrorBox text={walletError} /> : null}

          {walletData ? (
            <>
              <div className="walletRiskStrip">
                <MetricCard label="Largest Position" value={portfolioStats.largestSymbol} />
                <MetricCard label="Top Concentration" value={`${portfolioStats.concentration.toFixed(1)}%`} tone={portfolioStats.concentration > 50 ? 'negative' : ''} />
                <MetricCard label="High-Risk Positions" value={portfolioStats.highRisk} tone={portfolioStats.highRisk ? 'negative' : 'positive'} />
                <MetricCard label="Value in $10K+ Liq" value={`${portfolioStats.liquidPercent.toFixed(0)}%`} />
                <button className="toolButton walletExport" onClick={exportWalletCsv}>Export wallet CSV</button>
              </div>

              <div className="walletSummary">
                <MetricCard label="Total Portfolio" value={usd(walletData.portfolioTotalUsd ?? walletData.portfolioTokenValueUsd)} />
                <MetricCard label="SOL Value" value={walletData.solPriceUsd ? usd(walletData.solValueUsd) : '—'} />
                <MetricCard label="SOL Balance" value={number(walletData.solBalance, 4)} />
                <MetricCard label="Token Positions" value={walletData.tokenCount.toLocaleString()} />
                <MetricCard label="Buy Signals" value={walletSignals.buy} tone="positive" />
                <MetricCard label="Reduce / Sell" value={walletSignals.reduce} tone="negative" />
              </div>

              <article className="panel holdingsPanel">
                <PanelHeader eyebrow="POSITION INTELLIGENCE" title="Current holdings" />
                <div className="holdingsTableWrap">
                  <table className="holdingsTable">
                    <thead>
                      <tr>
                        <th>Token</th>
                        <th>Balance</th>
                        <th>Value</th>
                        <th>24H</th>
                        <th>Liquidity</th>
                        <th>Score</th>
                        <th>Signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {walletData.holdings.map((holding) => (
                        <tr key={holding.mint}>
                          <td>
                            <button
                              className="tokenCell"
                              onClick={() => {
                                setView('scanner')
                                runScan({ address: holding.mint })
                              }}
                            >
                              <strong>{holding.symbol || shortAddress(holding.mint, 4)}</strong>
                              <span>{holding.name || shortAddress(holding.mint)}</span>
                            </button>
                          </td>
                          <td>{number(holding.balance, holding.balance < 1 ? 6 : 2)}</td>
                          <td>{holding.valueUsd ? usd(holding.valueUsd) : '—'}</td>
                          <td className={holding.change24h >= 0 ? 'positiveText' : 'negativeText'}>
                            {holding.priceUsd ? percent(holding.change24h) : '—'}
                          </td>
                          <td>{holding.liquidityUsd ? compactUsd(holding.liquidityUsd) : '—'}</td>
                          <td>
                            {holding.intelligence
                              ? <ScorePill score={holding.intelligence.score} />
                              : <span className="mutedPill">N/A</span>}
                          </td>
                          <td>
                            {holding.intelligence
                              ? <SignalBadge signal={holding.intelligence.signal} />
                              : <span className="mutedPill">NO MARKET</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </>
          ) : (
            <div className="walletEmpty">
              <span className="walletGlyph">◎</span>
              <h3>Load a wallet to begin</h3>
              <p>Your test wallet is prefilled. RCXT reads public on-chain balances only—no wallet connection or signing required.</p>
            </div>
          )}
        </section>
      )}

      <footer className="footer">
        <div>
          <b>RCXT RADAR · v3.0.0 PRODUCTION</b>
          <span>Score engine v4.0.0 · Solana · DexScreener · Supabase · Vercel</span>
        </div>
        <p>
          Signals are software-generated market intelligence, not guarantees or personalized financial advice.
        </p>
      </footer>
    </main>
  )
}

function NavButton({ active, children, onClick }) {
  return (
    <button className={active ? 'navButton active' : 'navButton'} onClick={onClick}>
      {children}
    </button>
  )
}

function SignalBadge({ signal, large = false }) {
  const safe = String(signal || 'WATCH')
  const className =
    safe === 'BUY SETUP' ? 'buy' :
    safe === 'LEAN BUY' ? 'lean' :
    safe === 'WATCH' ? 'watch' :
    safe === 'REDUCE' ? 'reduce' : 'sell'

  return <span className={`signalBadge ${className} ${large ? 'large' : ''}`}>{safe}</span>
}

function ScoreRing({ score, large = false }) {
  const value = Math.max(0, Math.min(100, Number(score || 0)))
  return (
    <div
      className={large ? 'scoreRing large' : 'scoreRing'}
      style={{ '--score': `${value * 3.6}deg` }}
      aria-label={`RCXT score ${value} out of 100`}
    >
      <div>
        <strong>{value}</strong>
        <span>/100</span>
      </div>
    </div>
  )
}

function CalibrationStrip({ calibration, modelVersion, signal }) {
  const rows = (calibration?.rows || []).filter(
    (row) => row.scoreVersion === modelVersion && row.signal === signal,
  )
  const samples = rows.reduce((sum, row) => sum + Number(row.samples || 0), 0)

  if (samples < 20) {
    return (
      <div className="calibrationStrip collecting">
        <div>
          <span>MODEL CALIBRATION</span>
          <strong>Collecting forward outcomes</strong>
        </div>
        <small>{samples}/20 minimum signal samples · {calibration?.totalSamples || 0} total labeled outcomes</small>
      </div>
    )
  }

  return (
    <div className="calibrationStrip">
      <div className="calibrationTitle">
        <span>MODEL CALIBRATION · {signal}</span>
        <small>{samples} labeled outcomes</small>
      </div>
      <div className="calibrationRows">
        {rows.map((row) => (
          <div key={row.horizon}>
            <span>{row.horizon}</span>
            <strong>
              {row.directionalHitRate == null
                ? '—'
                : `${Math.round(row.directionalHitRate * 100)}% direction hit`}
            </strong>
            <small>
              avg {row.avgReturnPct == null ? '—' : `${row.avgReturnPct >= 0 ? '+' : ''}${row.avgReturnPct.toFixed(1)}%`}
              {' · '}{row.samples} samples
            </small>
          </div>
        ))}
      </div>
    </div>
  )
}

function ScoreTrend({ rows, currentScore, modelVersion }) {
  const compatible = (rows || []).filter((row) => row.scoreVersion === modelVersion)
  const legacyCount = Math.max(0, (rows?.length || 0) - compatible.length)
  const ordered = [...compatible].reverse()
  const previous = ordered.length > 1 ? ordered[ordered.length - 2] : null
  const delta = previous ? Number(currentScore || 0) - Number(previous.score || 0) : null

  return (
    <div className="scoreTrend">
      <div className="scoreTrendHead">
        <div>
          <span>RECENT {modelVersion} SCORE TREND</span>
          <strong>
            {delta === null ? 'Building comparable history' : `${delta >= 0 ? '+' : ''}${delta} pts vs prior v4 scan`}
          </strong>
        </div>
        <small>{compatible.length} comparable{legacyCount ? ` · ${legacyCount} legacy hidden` : ''}</small>
      </div>
      <div className="trendBars">
        {ordered.length
          ? ordered.slice(-10).map((row, index) => (
              <div className="trendPoint" key={`${row.createdAt}-${index}`}>
                <i style={{ height: `${Math.max(8, Math.min(100, Number(row.score || 0)))}%` }} />
                <span>{row.score}</span>
              </div>
            ))
          : <p>No comparable v4 history yet. Manual scans create history; 5-second refreshes do not.</p>}
      </div>
    </div>
  )
}

function ScoreAxes({ intelligence, compact = false }) {
  const axes = [
    ['Setup', intelligence?.setupScore],
    ['Execution', intelligence?.executionScore],
    ['Safety', intelligence?.safetyScore],
    ['Data', intelligence?.dataQualityScore],
  ]

  return (
    <div className={compact ? 'scoreAxes compact' : 'scoreAxes'}>
      {axes.map(([label, raw]) => {
        const value = Math.max(0, Math.min(100, Number(raw ?? 0)))
        const tone = value >= 70 ? 'good' : value >= 50 ? 'mid' : 'bad'
        return (
          <div className="scoreAxis" key={label}>
            <div><span>{label}</span><b className={tone}>{value}</b></div>
            <i><em className={tone} style={{ width: `${value}%` }} /></i>
          </div>
        )
      })}
    </div>
  )
}

function ScorePill({ score }) {
  const value = Number(score || 0)
  const tone = value >= 70 ? 'good' : value >= 50 ? 'mid' : 'bad'
  return <span className={`scorePill ${tone}`}>{value}</span>
}

function Metric({ label, value, tone = '' }) {
  return (
    <div className="miniMetric">
      <span>{label}</span>
      <b className={tone}>{value}</b>
    </div>
  )
}

function MetricCard({ label, value, tone = '' }) {
  return (
    <div className="metricCard">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  )
}

function PanelHeader({ eyebrow, title }) {
  return (
    <div className="panelHeader">
      <div>
        <span>{eyebrow}</span>
        <h3>{title}</h3>
      </div>
    </div>
  )
}

function ScoreBreakdown({ breakdown }) {
  const rows = [
    ['Liquidity', breakdown?.liquidity || 0],
    ['Activity', breakdown?.activity || 0],
    ['Order flow', breakdown?.orderFlow || 0],
    ['Momentum', breakdown?.momentum || 0],
    ['Maturity', breakdown?.maturity || 0],
    ['Contract', breakdown?.contract || 0],
  ]

  return (
    <div className="scoreBreakdown">
      {rows.map(([label, value]) => (
        <div className="breakdownRow" key={label}>
          <span>{label}</span>
          <div className="breakdownTrack">
            <i
              className={value >= 0 ? 'positiveBar' : 'negativeBar'}
              style={{
                width: `${Math.min(100, Math.max(8, Math.abs(value) * 5))}%`,
              }}
            />
          </div>
          <b className={value >= 0 ? 'positiveText' : 'negativeText'}>
            {value >= 0 ? '+' : ''}{value}
          </b>
        </div>
      ))}
    </div>
  )
}

function SecurityRow({ label, value, good = false, unknown = false }) {
  return (
    <div className="securityRow">
      <span>{label}</span>
      <b className={unknown ? '' : good ? 'positiveText' : 'negativeText'}>{value}</b>
    </div>
  )
}

function ErrorBox({ text }) {
  return <div className="errorBox"><b>REQUEST FAILED</b><span>{text}</span></div>
}

function RadarSkeleton() {
  return (
    <div className="radarCard skeletonCard">
      <i /><i /><i /><i />
    </div>
  )
}

function EmptyScanner({ history, onSelect }) {
  return (
    <div className="emptyScanner">
      <div className="emptyGraphic"><span>R</span><i /><i /></div>
      <h3>Paste a contract address above</h3>
      <p>RCXT will pull live market data, inspect the mint, score the setup, and surface a trade signal.</p>

      {history.length ? (
        <div className="history">
          <span>RECENT SCANS</span>
          <div>
            {history.map((item) => (
              <button key={item.address} onClick={() => onSelect(item)}>
                <strong>{item.symbol}</strong>
                <small>{item.score}/100 · {item.signal}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SocialProviderCard({ provider }) {
  const label = provider.source === 'x' ? 'X' : provider.source === 'reddit' ? 'Reddit' : 'Instagram'
  return (
    <div className={provider.available ? 'socialProvider active' : 'socialProvider unavailable'}>
      <div className="socialProviderHead">
        <strong>{label}</strong>
        <span>{provider.available ? 'LIVE' : 'OFFLINE'}</span>
      </div>
      {provider.available ? (
        <>
          <div className="socialProviderStats">
            <span>{provider.mentionCount} mentions</span>
            <span>{provider.uniqueAuthors} authors</span>
            <span>{provider.engagement} engagement</span>
          </div>
          <small>
            Relevance {Math.round(Number(provider.relevanceScore || 0))}/100 · sentiment {socialSentimentLabel(provider.sentiment)}
            {' · '}duplicates {Math.round(Number(provider.duplicateRatio || 0) * 100)}%
            {provider.authorConcentration
              ? ` · top-author share ${Math.round(Number(provider.authorConcentration) * 100)}%`
              : ''}
          </small>
          {provider.posts?.length ? (
            <div className="socialPostList">
              {provider.posts.slice(0, 3).map((post) => (
                <a key={post.id || post.url} href={post.url || '#'} target="_blank" rel="noreferrer">
                  <span>{String(post.text || '').replace(/\s+/g, ' ').slice(0, 110)}</span>
                  <small>{post.engagement || 0} engagement</small>
                </a>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <small>{provider.reason || 'Provider not configured.'}</small>
      )}
    </div>
  )
}

function socialSentimentLabel(value) {
  const n = Number(value || 0)
  if (n >= 0.25) return 'Bullish'
  if (n >= 0.08) return 'Positive'
  if (n <= -0.25) return 'Bearish'
  if (n <= -0.08) return 'Negative'
  return 'Neutral'
}

function CompareTray({ items, onRemove, onOpen }) {
  return (
    <div className="compareTray">
      <div className="compareHead">
        <div><span>COMPARE MODE</span><small>{items.length}/4 tokens</small></div>
      </div>
      <div className="compareGrid">
        {items.map((item) => (
          <div className="compareCard" key={item.address}>
            <button className="compareRemove" onClick={() => onRemove(item)}>×</button>
            <button className="compareOpen" onClick={() => onOpen(item)}>
              <strong>{item.symbol || item.token?.symbol || 'TOKEN'}</strong>
              <span>{item.intelligence?.score ?? '—'}/100</span>
            </button>
            <small>{item.intelligence?.signal || 'WATCH'}</small>
            <div><span>MC</span><b>{compactUsd(item.marketCap || item.market?.marketCap)}</b></div>
            <div><span>LIQ</span><b>{compactUsd(item.liquidityUsd || item.market?.liquidityUsd)}</b></div>
            <div><span>24H</span><b className={Number(item.change24h ?? item.market?.priceChange?.h24) >= 0 ? 'positiveText' : 'negativeText'}>{percent(item.change24h ?? item.market?.priceChange?.h24)}</b></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((value) => {
    const text = String(value ?? '')
    return `"${text.replaceAll('"', '""')}"`
  }).join(',')).join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function scenarioMultiple(currentMarketCap, targetMarketCap) {
  const current = Number(currentMarketCap || 0)
  const target = Number(targetMarketCap || 0)
  if (!current || !target) return '—'
  return `${(target / current).toFixed(2)}x`
}

function scenarioValue(positionSize, currentMarketCap, targetMarketCap) {
  const position = Number(positionSize || 0)
  const current = Number(currentMarketCap || 0)
  const target = Number(targetMarketCap || 0)
  if (!position || !current || !target) return '—'
  return usd(position * (target / current))
}

function scenarioProfit(positionSize, currentMarketCap, targetMarketCap) {
  const position = Number(positionSize || 0)
  const current = Number(currentMarketCap || 0)
  const target = Number(targetMarketCap || 0)
  if (!position || !current || !target) return '—'
  const profit = position * (target / current) - position
  return `${profit >= 0 ? '+' : ''}${usd(profit)}`
}

function number(value, digits = 2) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  })
}

function usd(value) {
  return Number(value || 0).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

function compactUsd(value) {
  return '$' + Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

function tinyUsd(value) {
  const amount = Number(value || 0)
  if (!amount) return '$0'
  if (amount >= 1) return '$' + amount.toLocaleString(undefined, { maximumFractionDigits: 4 })
  if (amount >= 0.001) return '$' + amount.toFixed(6)
  return '$' + amount.toPrecision(4)
}

function percent(value) {
  const amount = Number(value || 0)
  return `${amount >= 0 ? '+' : ''}${amount.toFixed(2)}%`
}

function shortAddress(value, size = 6) {
  if (!value) return '—'
  return `${value.slice(0, size)}…${value.slice(-size)}`
}

function formatAge(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}
