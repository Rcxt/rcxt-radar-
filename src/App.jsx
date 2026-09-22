'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

const TEST_WALLET = '976CYJJEVhntZhKS5wdUb3mz2w8FxViDbfCWK8xg2eQ7'
const HISTORY_KEY = 'rcxt-scan-history-v1'
const HIDDEN_KEY = 'rcxt-hidden-coins-v1'
const NOTIFY_KEY = 'rcxt-notifications-v1'

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
  }, [])

  useEffect(() => {
    loadRadar()

    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
      if (Array.isArray(saved)) setHistory(saved.slice(0, 12))

      const hidden = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')
      if (Array.isArray(hidden)) setHiddenCoins(hidden.filter((item) => item?.address))

      const notifySaved = localStorage.getItem(NOTIFY_KEY) === 'enabled'
      setNotificationsEnabled(notifySaved && typeof Notification !== 'undefined' && Notification.permission === 'granted')
    } catch {
      // Ignore malformed local history.
    }
  }, [loadRadar])

  useEffect(() => {
    if (view !== 'radar') return

    const timer = setInterval(() => {
      loadRadar()
    }, 10000)

    return () => clearInterval(timer)
  }, [view, loadRadar])

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
      const response = await fetch(`/api/scan?address=${encodeURIComponent(target)}`, {
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Scan failed')

      setTokenAddress(target)
      setScan((previous) => {
        if (silent && previous?.address === data.scan.address) {
          maybeNotifySignalChange(previous, data.scan)
        }
        return data.scan
      })
      setLastRefresh(new Date())

      if (!silent) {
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
  }, [tokenAddress])

  useEffect(() => {
    if (!autoRefresh || !scan?.address) return

    const timer = setInterval(() => {
      runScan({ address: scan.address, silent: true })
    }, 5000)

    return () => clearInterval(timer)
  }, [autoRefresh, scan?.address, runScan])

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

  async function askAI() {
    if (!scan) return

    setAiLoading(true)
    setAiAnalysis('')

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan }),
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

  const hiddenAddresses = useMemo(
    () => new Set(hiddenCoins.map((coin) => coin.address)),
    [hiddenCoins],
  )

  const visibleRadar = useMemo(
    () => radar.filter((item) => !hiddenAddresses.has(item.address)),
    [radar, hiddenAddresses],
  )

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
          <div className="systemStatus">
            <span className="pulse" />
            <span>LIVE</span>
            <small>Solana + DexScreener</small>
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
                      <small>RCXT SCORE</small>
                      <b>{item.intelligence.grade} · {item.intelligence.confidence}% confidence</b>
                    </div>
                  </div>
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
                    <span>Open full scan →</span>
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
                </div>

                <ScoreRing score={scan.intelligence.score} large />
              </div>

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
              <div className="walletSummary">
                <MetricCard label="SOL Balance" value={number(walletData.solBalance, 4)} />
                <MetricCard label="Token Positions" value={walletData.tokenCount.toLocaleString()} />
                <MetricCard label="Tracked Token Value" value={usd(walletData.portfolioTokenValueUsd)} />
                <MetricCard label="Buy Signals" value={walletSignals.buy} tone="positive" />
                <MetricCard label="Watch" value={walletSignals.watch} />
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
          <b>RCXT RADAR</b>
          <span>Built on Solana · DexScreener · Supabase · Vercel AI Gateway</span>
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
