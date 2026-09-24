import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import V4AnalyticsSuite from './components/V4Analytics.jsx'
import ChallengeTracker from './components/ChallengeTracker.jsx'
import WalletActivity from './components/WalletActivity.jsx'
import XSocialIntel from './components/XSocialIntel.jsx'
import NotificationCenter from './components/NotificationCenter.jsx'
import DetailSection from './components/DetailSection.jsx'
import SectionBoundary from './components/SectionBoundary.jsx'
import { deriveScanVerdict } from './lib/scan-verdict.js'
import { listChains } from '../lib/chains.js'
import {
  DEFAULT_NOTIFICATION_PREFS,
  normalizeNotificationPrefs,
  shouldNotifySignalTransition,
} from './lib/notification-prefs.js'
import { criticalStructureFlags } from './lib/risk-policy.js'

const WALLET_KEY = 'rcxt-wallet-address-v1'
const HISTORY_KEY = 'rcxt-scan-history-v1'
const HIDDEN_KEY = 'rcxt-hidden-coins-v1'
const NOTIFY_KEY = 'rcxt-notifications-v1'
const NOTIFY_PREFS_KEY = 'rcxt-notification-prefs-v2'
const ALERT_DEDUPE_KEY = 'rcxt-alert-dedupe-v2'
const WATCH_KEY = 'rcxt-watchlist-v1'
const RULES_KEY = 'rcxt-alert-rules-v1'
const NOTES_KEY = 'rcxt-token-notes-v1'

function itemChainId(item, fallback = 'solana') {
  return String(item?.chain?.id || item?.chain || fallback || 'solana').toLowerCase()
}

function assetKey(item, fallback = 'solana') {
  const chain = itemChainId(item, fallback)
  const rawAddress = String(item?.address || item?.mint || '')
  const address = chain === 'solana' ? rawAddress : rawAddress.toLowerCase()
  return `${chain}:${address}`
}

function tokenDeepLink(item, fallback = 'solana') {
  const address=String(item?.address||item?.mint||'')
  if(!address) return '/'
  const params=new URLSearchParams({token:address,chain:itemChainId(item,fallback)})
  return '/?'+params.toString()
}

function readStoredJson(key, fallback) {
  try {
    const raw=localStorage.getItem(key)
    return raw==null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}
const SCAN_CHAIN_OPTIONS = [{ id:'auto', label:'Auto-detect' }, ...listChains().map((chain)=>({ id:chain.id, label:chain.label }))]

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replaceAll('-', '+').replaceAll('_', '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
}

export default function Home() {
  const [view, setView] = useState('radar')
  const activeScanAddressRef = useRef('')
  const activeScanChainRef = useRef('auto')
  const scanRequestIdRef = useRef(0)
  const walletRequestIdRef = useRef(0)
  const monitorRequestIdRef = useRef(0)
  const runScanRef = useRef(null)
  const [radar, setRadar] = useState([])
  const [radarLoading, setRadarLoading] = useState(true)
  const [radarError, setRadarError] = useState('')

  const [tokenAddress, setTokenAddress] = useState('')
  const [scanChain, setScanChain] = useState('auto')
  const [scan, setScan] = useState(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)

  const [aiAnalysis, setAiAnalysis] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiMode, setAiMode] = useState('beginner')
  const [marketContext, setMarketContext] = useState(null)

  const [wallet, setWallet] = useState('')
  const [walletData, setWalletData] = useState(null)
  const [walletLoading, setWalletLoading] = useState(false)
  const [walletError, setWalletError] = useState('')

  const [history, setHistory] = useState([])
  const [hiddenCoins, setHiddenCoins] = useState([])
  const [showHidden, setShowHidden] = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [notificationStatus, setNotificationStatus] = useState('')
  const [notificationPrefs, setNotificationPrefs] = useState(DEFAULT_NOTIFICATION_PREFS)
  const notificationPrefsRef = useRef(DEFAULT_NOTIFICATION_PREFS)
  const [liveMonitor, setLiveMonitor] = useState({
    enabled:false,
    loading:false,
    subscriptionCount:0,
    lastCheckedAt:null,
    lastEventAt:null,
    lastError:null,
    vapidPublicKey:null,
    preferences:DEFAULT_NOTIFICATION_PREFS,
  })
  const [watchlist, setWatchlist] = useState([])
  const [showWatchlist, setShowWatchlist] = useState(false)
  const [compare, setCompare] = useState([])
  const [radarSearch, setRadarSearch] = useState('')
  const [radarSort, setRadarSort] = useState('score')
  const [signalFilter, setSignalFilter] = useState('ALL')
  const [minScore, setMinScore] = useState(0)
  const [minLiquidity, setMinLiquidity] = useState(0)
  const [health, setHealth] = useState(null)
  const [alertScore, setAlertScore] = useState(75)
  const [alertMarketCap, setAlertMarketCap] = useState('')
  const [tokenNote, setTokenNote] = useState('')
  const [scoreHistory, setScoreHistory] = useState([])
  const [calibration, setCalibration] = useState({ totalSamples: 0, rows: [], buckets: [], components: [] })
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeDrawer, setActiveDrawer] = useState('')
  const [radarPreset, setRadarPreset] = useState('balanced')
  const [tradePlans, setTradePlans] = useState([])

  useEffect(() => {
    notificationPrefsRef.current = notificationPrefs
  }, [notificationPrefs])

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
      const saved = readStoredJson(HISTORY_KEY, [])
      if (Array.isArray(saved)) setHistory(saved.slice(0, 12))

      const hidden = readStoredJson(HIDDEN_KEY, [])
      if (Array.isArray(hidden)) setHiddenCoins(hidden.filter((item) => item?.address))

      const notifySaved = localStorage.getItem(NOTIFY_KEY) === 'enabled'
      setNotificationsEnabled(notifySaved && typeof Notification !== 'undefined' && Notification.permission === 'granted')

      const savedNotificationPrefs = normalizeNotificationPrefs(
        readStoredJson(NOTIFY_PREFS_KEY, {})
      )
      setNotificationPrefs(savedNotificationPrefs)

      const savedWatchlist = readStoredJson(WATCH_KEY, [])
      if (Array.isArray(savedWatchlist)) setWatchlist(savedWatchlist.filter((item) => item?.address).slice(0, 50))

      const savedWallet = localStorage.getItem(WALLET_KEY) || ''
      if (savedWallet) setWallet(savedWallet)

      const savedRules = readStoredJson(RULES_KEY, {})
      if (Number.isFinite(Number(savedRules.score))) setAlertScore(Number(savedRules.score))
      if (savedRules.marketCap != null) setAlertMarketCap(String(savedRules.marketCap))
      if (
        !localStorage.getItem(NOTIFY_PREFS_KEY) &&
        typeof savedRules.signalChanges === 'boolean'
      ) {
        const migratedPrefs=normalizeNotificationPrefs({...DEFAULT_NOTIFICATION_PREFS,signalChanges:savedRules.signalChanges})
        setNotificationPrefs(migratedPrefs)
        try{localStorage.setItem(NOTIFY_PREFS_KEY,JSON.stringify(migratedPrefs))}catch{}
      }
    } catch {
      // Ignore malformed local history.
    }
  }, [loadRadar])

  useEffect(() => {
    function loadTradePlans() {
      try {
        const plansByAsset = new Map()
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index)
          if (!key?.startsWith('rcxt-trade-plan:')) continue
          const plan = readStoredJson(key, null)
          if (!plan?.address) continue
          const normalized={...plan,chain:itemChainId(plan,'solana')}
          const identity=assetKey(normalized)
          const current=plansByAsset.get(identity)
          if(!current||Number(normalized.savedAt||0)>=Number(current.savedAt||0)){
            plansByAsset.set(identity,normalized)
          }
        }
        const plans=[...plansByAsset.values()]
        plans.sort((a,b) => Number(b.savedAt || 0) - Number(a.savedAt || 0))
        setTradePlans(plans.slice(0, 100))
      } catch {
        setTradePlans([])
      }
    }

    loadTradePlans()
    const handleUpdate = () => loadTradePlans()
    window.addEventListener('rcxt-trade-plan-updated', handleUpdate)
    window.addEventListener('storage', handleUpdate)

    return () => {
      window.removeEventListener('rcxt-trade-plan-updated', handleUpdate)
      window.removeEventListener('storage', handleUpdate)
    }
  }, [])

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
        const response = await fetch('/api/history?calibration=1', { cache: 'no-store' })
        const data = await response.json()
        if (active && response.ok && data?.success) {
          setCalibration({
            totalSamples: data.totalSamples || 0,
            rows: data.rows || [],
            buckets: data.buckets || [],
            components: data.components || [],
          })
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

  const runScan = useCallback(async ({ address, chain, silent = false } = {}) => {
    const target = String(address ?? tokenAddress).trim()
    if (!target) return
    const selectedChain = String(chain ?? (silent ? activeScanChainRef.current : scanChain) ?? 'auto').toLowerCase()
    if (silent && activeScanAddressRef.current !== target) return
    const requestId=++scanRequestIdRef.current
    if (!silent) {
      activeScanAddressRef.current = target
      activeScanChainRef.current = selectedChain
    }

    if (!silent) {
      setScanLoading(true)
      setAiAnalysis('')
      setAiModel('')
    }

    setScanError('')

    try {
      const persist = silent ? '0' : '1'
      const response = await fetch(`/api/scan?address=${encodeURIComponent(target)}&chain=${encodeURIComponent(selectedChain)}&persist=${persist}`, {
        cache: 'no-store',
      })
      const data = await response.json()
      if (requestId!==scanRequestIdRef.current || activeScanAddressRef.current !== target) return
      if (!response.ok || !data.success) throw new Error(data.error || 'Scan failed')

      setTokenAddress(target)
      activeScanChainRef.current = data.scan?.chain?.id || selectedChain
      setScan((previous) => {
        if (silent && previous?.address === data.scan.address) {
          maybeNotifySignalChange(previous, data.scan)
          maybeNotifyRuleCrossings(previous, data.scan)
          maybeNotifyRiskEscalation(previous, data.scan)
        }
        return data.scan
      })
      setLastRefresh(new Date())

      try {
        const notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}')
        const noteKey = `${data.scan?.chain?.id || 'solana'}:${String(data.scan.address).toLowerCase()}`
        setTokenNote(notes[noteKey] || notes[data.scan.address] || '')
      } catch {
        setTokenNote('')
      }

      if (!silent) {
        try {
          const historyResponse = await fetch(`/api/history?address=${encodeURIComponent(target)}&chain=${encodeURIComponent(data.scan?.chain?.id || selectedChain)}`, { cache: 'no-store' })
          const historyData = await historyResponse.json()
          if (requestId===scanRequestIdRef.current && activeScanAddressRef.current === target && historyResponse.ok && historyData?.success) setScoreHistory(historyData.rows || [])
        } catch {
          if (requestId===scanRequestIdRef.current && activeScanAddressRef.current === target) setScoreHistory([])
        }

        const entry = {
          address: data.scan.address,
          symbol: data.scan.token.symbol,
          name: data.scan.token.name,
          score: data.scan.intelligence.score,
          signal: data.scan.intelligence.signal,
          chain: data.scan?.chain?.id || selectedChain,
          chainLabel: data.scan?.chain?.label || data.scan?.chain?.id || selectedChain,
          time: Date.now(),
        }

        setHistory((current) => {
          const next = [
            entry,
            ...current.filter((item) => !(item.address === entry.address && (item.chain || 'solana') === (entry.chain || 'solana'))),
          ].slice(0, 12)

          localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
          return next
        })
      }
    } catch (error) {
      if (requestId!==scanRequestIdRef.current || activeScanAddressRef.current !== target) return
      setScanError(error.message)
      if (!silent) setScan(null)
    } finally {
      if (!silent && requestId===scanRequestIdRef.current && activeScanAddressRef.current === target) setScanLoading(false)
    }
  }, [tokenAddress, scanChain, notificationsEnabled, alertScore, alertMarketCap, notificationPrefs])

  useEffect(() => { runScanRef.current = runScan }, [runScan])

  function navigateView(nextView) {
    setActiveDrawer('')
    setMenuOpen(false)
    setView(nextView)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  useEffect(() => {
    function openLinkedToken(value, chainValue = 'auto') {
      const address = String(value || '').trim()
      const valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) || /^0x[a-fA-F0-9]{40}$/.test(address)
      if (!valid) return false
      const nextChain = String(chainValue || 'auto').toLowerCase()
      setActiveDrawer('')
      setMenuOpen(false)
      setView('scanner')
      setTokenAddress(address)
      setScanChain(nextChain)
      const params = new URLSearchParams({ token:address })
      if (nextChain !== 'auto') params.set('chain',nextChain)
      window.history.replaceState(null, '', '/?' + params.toString())
      window.scrollTo({ top: 0, behavior: 'instant' })
      runScanRef.current?.({ address, chain:nextChain })
      return true
    }
    const fromUrl = () => {
      const params=new URLSearchParams(window.location.search)
      return openLinkedToken(params.get('token'),params.get('chain')||'auto')
    }
    const onMessage = (event) => {
      if (event.data?.type !== 'RCXT_OPEN_TOKEN') return
      if (openLinkedToken(event.data.token,event.data.chain||'auto')) event.ports?.[0]?.postMessage({ opened: true })
    }
    fromUrl()
    window.addEventListener('popstate', fromUrl)
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('popstate', fromUrl)
      navigator.serviceWorker?.removeEventListener('message', onMessage)
    }
  }, [])

  useEffect(() => {
    const onEscape = (event) => {
      if (event.key === 'Escape') { setActiveDrawer(''); setMenuOpen(false) }
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [])

  useEffect(() => {
    if (!notificationStatus) return
    const timer = window.setTimeout(() => setNotificationStatus(''), 6000)
    return () => window.clearTimeout(timer)
  }, [notificationStatus])

  useEffect(() => {
    if (!autoRefresh || !scan?.address) return

    const timer = setInterval(() => {
      runScan({ address: scan.address, chain:scan?.chain?.id || activeScanChainRef.current, silent: true })
    }, 15000)

    return () => clearInterval(timer)
  }, [autoRefresh, scan?.address, scan?.chain?.id, runScan])

  const loadLiveMonitor = useCallback(async (targetWallet = wallet) => {
    const address = String(targetWallet || '').trim()
    const requestId=++monitorRequestIdRef.current
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      setLiveMonitor((current) => ({ ...current, enabled:false, loading:false, subscriptionCount:0 }))
      return null
    }

    setLiveMonitor((current) => ({ ...current, loading:true }))
    try {
      const response = await fetch('/api/monitor?wallet=' + encodeURIComponent(address), { cache:'no-store' })
      const data = await response.json()
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Monitor status unavailable')
      if(requestId!==monitorRequestIdRef.current) return null
      const serverPrefs=data.preferencesStored
        ? normalizeNotificationPrefs(data.preferences)
        : normalizeNotificationPrefs(notificationPrefs)
      if(data.preferencesStored){
        setNotificationPrefs(serverPrefs)
        try{ localStorage.setItem(NOTIFY_PREFS_KEY,JSON.stringify(serverPrefs)) }catch{}
      }
      setLiveMonitor({
        enabled:Boolean(data.enabled),
        loading:false,
        subscriptionCount:Number(data.subscriptionCount || 0),
        lastCheckedAt:data.lastCheckedAt || null,
        lastEventAt:data.lastEventAt || null,
        lastError:data.lastError || null,
        vapidPublicKey:data.vapidPublicKey || null,
        preferences:serverPrefs,
      })
      return {...data,preferences:serverPrefs}
    } catch (error) {
      if(requestId!==monitorRequestIdRef.current) return null
      setLiveMonitor((current) => ({
        ...current,
        loading:false,
        lastError:error?.message || 'Monitor status unavailable',
      }))
      return null
    }
  }, [wallet, notificationPrefs])

  useEffect(() => {
    if (!wallet) return
    loadLiveMonitor(wallet)
    const timer = setInterval(() => loadLiveMonitor(wallet), 60000)
    return () => clearInterval(timer)
  }, [wallet])

  async function enableLiveMonitor() {
    const address = String(wallet || '').trim()
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      setNotificationStatus('Load your Solana wallet first, then turn Live Monitor on.')
      setView('wallet')
      return
    }

    setLiveMonitor((current) => ({ ...current, loading:true }))
    try {
      if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Background push is not available in this browser. On iPhone, add RCXT to your Home Screen and open it there.')
      }

      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('Notification permission is required for 24/7 alerts.')

      const status = await loadLiveMonitor(address)
      const publicKey = status?.vapidPublicKey || liveMonitor.vapidPublicKey
      if (!publicKey) throw new Error('RCXT push key is not available yet.')

      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly:true,
          applicationServerKey:urlBase64ToUint8Array(publicKey),
        })
      }

      const subscribeResponse = await fetch('/api/monitor', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          action:'subscribe',
          wallet:address,
          subscription:subscription.toJSON ? subscription.toJSON() : subscription,
        }),
      })
      const subscribeData = await subscribeResponse.json()
      if (!subscribeResponse.ok || !subscribeData?.success) {
        throw new Error(subscribeData?.error || 'Could not register push alerts')
      }

      const enableResponse = await fetch('/api/monitor', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({ action:'enable', wallet:address, preferences:notificationPrefs }),
      })
      const enabledData = await enableResponse.json()
      if (!enableResponse.ok || !enabledData?.success) {
        throw new Error(enabledData?.error || 'Could not enable background monitor')
      }

      localStorage.setItem(NOTIFY_KEY, 'enabled')
      setNotificationsEnabled(true)
      setLiveMonitor((current) => ({
        ...current,
        enabled:true,
        loading:false,
        subscriptionCount:Number(enabledData.subscriptionCount || subscribeData.subscriptionCount || 1),
        lastCheckedAt:enabledData.lastCheckedAt || current.lastCheckedAt,
        lastEventAt:enabledData.lastEventAt || current.lastEventAt,
        lastError:null,
      }))
      setNotificationStatus('Live Monitor ACTIVE — RCXT now checks your wallet in the background and can alert you even when the app is closed.')
    } catch (error) {
      setLiveMonitor((current) => ({ ...current, loading:false, lastError:error?.message || 'Could not enable Live Monitor' }))
      setNotificationStatus(error?.message || 'Could not enable Live Monitor.')
    }
  }

  async function disableLiveMonitor() {
    const address = String(wallet || '').trim()
    setLiveMonitor((current) => ({ ...current, loading:true }))
    try {
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
        const response = await fetch('/api/monitor', {
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({ action:'disable', wallet:address, preferences:notificationPrefs }),
        })
        const data = await response.json()
        if (!response.ok || !data?.success) throw new Error(data?.error || 'Could not disable monitor')
      }
      localStorage.removeItem(NOTIFY_KEY)
      setNotificationsEnabled(false)
      setLiveMonitor((current) => ({ ...current, enabled:false, loading:false, lastError:null }))
      setNotificationStatus('Live Monitor INACTIVE — background wallet checks and RCXT push alerts are off.')
    } catch (error) {
      setLiveMonitor((current) => ({ ...current, loading:false, lastError:error?.message || 'Could not disable monitor' }))
      setNotificationStatus(error?.message || 'Could not disable Live Monitor.')
    }
  }

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
        setNotificationStatus('Buy detection, rug-risk, and signal alerts enabled while RCXT is active.')

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

  async function saveNotificationPreferences(nextPrefs) {
    const clean=normalizeNotificationPrefs(nextPrefs)
    setNotificationPrefs(clean)
    setLiveMonitor((current)=>({...current,preferences:clean}))
    try{ localStorage.setItem(NOTIFY_PREFS_KEY,JSON.stringify(clean)) }catch{}

    const address=String(wallet||'').trim()
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return

    try{
      const response=await fetch('/api/monitor',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({action:'preferences',wallet:address,preferences:clean}),
      })
      const data=await response.json()
      if(response.ok&&data?.success){
        const serverPrefs=normalizeNotificationPrefs(data.preferences||clean)
        setNotificationPrefs(serverPrefs)
        setLiveMonitor((current)=>({...current,preferences:serverPrefs}))
        try{ localStorage.setItem(NOTIFY_PREFS_KEY,JSON.stringify(serverPrefs)) }catch{}
      }
    }catch{}
  }

  function localAlertAllowed(key,{critical=false,cooldownMinutes=notificationPrefs.cooldownMinutes}={}){
    if(typeof window==='undefined') return false
    try{
      const now=Date.now()
      const stored=JSON.parse(localStorage.getItem(ALERT_DEDUPE_KEY)||'{}')
      const previous=Number(stored?.[key]||0)
      const cooldown=Math.max(1,Number(cooldownMinutes||20))*60_000
      if(previous>0&&now-previous<cooldown) return false
      const next={...stored,[key]:now}
      const entries=Object.entries(next).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,120)
      localStorage.setItem(ALERT_DEDUPE_KEY,JSON.stringify(Object.fromEntries(entries)))
      return true
    }catch{
      return true
    }
  }

  async function showRcxtAlert(key,title,body,{tag,url,critical=false,cooldownMinutes}={}){
    if(!notificationsEnabled||typeof Notification==='undefined'||Notification.permission!=='granted') return
    if(!localAlertAllowed(key,{critical,cooldownMinutes})) return
    try{
      const registration=await navigator.serviceWorker?.ready
      if(!registration?.showNotification) return
      await registration.showNotification(title,{
        body,
        icon:'/icon.svg',
        badge:'/icon.svg',
        tag:tag||key,
        renotify:Boolean(critical),
        requireInteraction:Boolean(critical),
        data:{url:url||'/'},
      })
    }catch{}
  }

  function maybeNotifySignalChange(previous, next) {
    const before=previous?.intelligence?.signal
    const after=next?.intelligence?.signal
    if(!shouldNotifySignalTransition(before,after,notificationPrefs)) return

    const kind=['REDUCE','SELL / AVOID'].includes(after)?'danger':'upgrade'
    showRcxtAlert(
      `signal:${next.address}:${after}`,
      `${next.token?.symbol||'Token'} ${kind==='danger'?'risk signal':'signal upgrade'}`,
      `${before} → ${after} · RCXT ${next.intelligence?.score??'—'}/100 · opportunity ${next.intelligence?.opportunityScore??next.intelligence?.setupScore??'—'}/100`,
      {
        tag:`signal-${next.address}`,
        url:tokenDeepLink(next),
        critical:after==='SELL / AVOID',
      },
    )
  }

  function maybeNotifyRadarChanges(previous, next) {
    const prefs=notificationPrefsRef.current
    if(!prefs.radarChanges) return
    if(!Array.isArray(previous)||previous.length===0) return

    const before=new Map(previous.map((item)=>[item.address,item.intelligence?.signal]))
    for(const item of next){
      const oldSignal=before.get(item.address)
      const newSignal=item.intelligence?.signal
      if(!shouldNotifySignalTransition(oldSignal,newSignal,prefs)) continue

      showRcxtAlert(
        `radar:${item.address}:${newSignal}`,
        `${item.symbol||'Token'}: ${newSignal}`,
        `RCXT ${item.intelligence?.score??'—'}/100 · opportunity ${item.intelligence?.opportunityScore??item.intelligence?.setupScore??'—'}/100 · ${item.intelligence?.risk||'risk'} risk`,
        {
          tag:`radar-${item.address}`,
          url:tokenDeepLink(item,'solana'),
          critical:newSignal==='SELL / AVOID',
        },
      )
    }
  }

  function maybeNotifyRuleCrossings(previous, next) {
    const scoreTarget=Number(alertScore||0)
    if(
      notificationPrefs.scoreCrossing &&
      scoreTarget>0 &&
      Number(previous?.intelligence?.score||0)<scoreTarget &&
      Number(next?.intelligence?.score||0)>=scoreTarget
    ){
      showRcxtAlert(
        `score:${next.address}:${scoreTarget}`,
        `${next.token?.symbol||'Token'} crossed RCXT ${scoreTarget}`,
        `Score is now ${next.intelligence?.score}/100 · ${next.intelligence?.signal} · opportunity ${next.intelligence?.opportunityScore??next.intelligence?.setupScore??'—'}/100`,
        {tag:`score-${itemChainId(next)}-${next.address}`,url:tokenDeepLink(next)},
      )
    }

    const marketCapTarget=Number(alertMarketCap||0)
    if(
      notificationPrefs.marketCapCrossing &&
      marketCapTarget>0 &&
      Number(previous?.market?.marketCap||0)<marketCapTarget &&
      Number(next?.market?.marketCap||0)>=marketCapTarget
    ){
      showRcxtAlert(
        `mc:${next.address}:${marketCapTarget}`,
        `${next.token?.symbol||'Token'} hit MC target`,
        `Market cap crossed ${compactUsd(marketCapTarget)} · now ${compactUsd(next.market?.marketCap)}`,
        {tag:`mc-${itemChainId(next)}-${next.address}`,url:tokenDeepLink(next)},
      )
    }
  }

  function maybeNotifyRiskEscalation(previous, next) {
    const beforeFlags=new Set(criticalStructureFlags(previous))
    const afterFlags=criticalStructureFlags(next)
    const newDanger=afterFlags.filter((flag)=>!beforeFlags.has(flag))
    const riskRank={LOWER:0,MODERATE:1,HIGH:2,EXTREME:3}
    const beforeRank=riskRank[previous?.intelligence?.risk]??0
    const afterRank=riskRank[next?.intelligence?.risk]??0
    const severeEscalation=afterRank>=2&&afterRank>beforeRank

    if(!newDanger.length&&!severeEscalation) return
    if(newDanger.length&&!notificationPrefs.rugRisk) return
    if(!newDanger.length&&!notificationPrefs.highRiskBuy) return

    const rugLike=newDanger.length>0
    const title=rugLike
      ? `RCXT RUG RISK: ${next.token?.symbol||'Token'}`
      : `RCXT risk increased: ${next.token?.symbol||'Token'}`
    const detail=rugLike
      ? newDanger.slice(0,2).map((flag)=>flag.replaceAll('_',' ').toLowerCase()).join(' · ')
      : `${next.intelligence?.risk} risk · ${next.intelligence?.signal}`

    showRcxtAlert(
      `risk:${next.address}:${rugLike?newDanger.sort().join('-'):next.intelligence?.risk}`,
      title,
      `RCXT ${next.intelligence?.score??'—'}/100 · ${detail}`,
      {
        tag:`risk-${itemChainId(next)}-${next.address}`,
        url:tokenDeepLink(next),
        critical:rugLike,
      },
    )
  }

  function saveAlertRules(next = {}) {
    const rules = {
      score: next.score ?? alertScore,
      marketCap: next.marketCap ?? alertMarketCap,
      signalChanges: next.signalChanges ?? notificationPrefs.signalChanges,
    }
    localStorage.setItem(RULES_KEY, JSON.stringify(rules))
  }

  function saveTokenNote() {
    if (!scan?.address) return
    try {
      const notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}')
      const noteKey = `${scan?.chain?.id || 'solana'}:${String(scan.address).toLowerCase()}`
      notes[noteKey] = tokenNote.slice(0, 2000)
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes))
      setNotificationStatus('Token note saved.')
    } catch {
      setNotificationStatus('Could not save token note.')
    }
  }

  async function shareCurrentToken() {
    if (!scan?.address) return
    const params = new URLSearchParams({ token:scan.address })
    if (scan?.chain?.id) params.set('chain',scan.chain.id)
    const url = `${window.location.origin}/?${params.toString()}`
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

  async function askAI(mode = aiMode) {
    if (!scan) return

    setAiMode(mode)
    setAiLoading(true)
    setAiAnalysis('')

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan, social: null, mode, marketContext }),
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
    const requestId=++walletRequestIdRef.current

    setWalletLoading(true)
    setWalletError('')

    try {
      const response = await fetch(`/api/wallet?address=${encodeURIComponent(address)}`, {
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Wallet load failed')
      if(requestId!==walletRequestIdRef.current) return
      localStorage.setItem(WALLET_KEY, address)
      setWalletData(data)
    } catch (error) {
      if(requestId===walletRequestIdRef.current) setWalletError(error.message)
    } finally {
      if(requestId===walletRequestIdRef.current) setWalletLoading(false)
    }
  }

  function openRadarToken(item) {
    const chain = itemChainId(item,'solana')
    navigateView('scanner')
    setTokenAddress(item.address)
    setScanChain(chain)
    runScan({ address:item.address, chain })
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

  function applyRadarPreset(preset) {
    setRadarPreset(preset)
    setRadarSearch('')

    if (preset === 'trench') {
      setSignalFilter('ALL')
      setMinScore(25)
      setMinLiquidity(3000)
      setRadarSort('trench')
    } else if (preset === 'safer') {
      setSignalFilter('ALL')
      setMinScore(65)
      setMinLiquidity(50000)
      setRadarSort('score')
    } else if (preset === 'new') {
      setSignalFilter('ALL')
      setMinScore(35)
      setMinLiquidity(3000)
      setRadarSort('discovery')
    } else if (preset === 'discovery') {
      setSignalFilter('ALL')
      setMinScore(50)
      setMinLiquidity(5000)
      setRadarSort('momentum')
    } else {
      setSignalFilter('ALL')
      setMinScore(0)
      setMinLiquidity(15000)
      setRadarSort('score')
    }

    setView('radar')
    setMenuOpen(false)
  }

  function resetRadarWorkspace() {
    setRadarPreset('balanced')
    setRadarSearch('')
    setSignalFilter('ALL')
    setMinScore(0)
    setMinLiquidity(0)
    setRadarSort('score')
    setCompare([])
    setNotificationStatus('Radar workspace reset. Saved watchlist and hidden coins were kept.')
    setMenuOpen(false)
  }

  function openDrawer(name) {
    setActiveDrawer(name)
    setMenuOpen(false)
  }

  function openTradePlan(plan) {
    if (!plan?.address) return
    const chain=itemChainId(plan,'solana')
    navigateView('scanner')
    setTokenAddress(plan.address)
    setScanChain(chain)
    runScan({ address:plan.address, chain })
  }

  function deleteTradePlan(plan) {
    if (!plan?.address) return
    const chain=itemChainId(plan,'solana')
    const address=chain==='solana'?String(plan.address):String(plan.address).toLowerCase()
    try {
      localStorage.removeItem('rcxt-trade-plan:' + chain + ':' + address)
      if(chain==='solana') localStorage.removeItem('rcxt-trade-plan:' + plan.address)
      setTradePlans((current) => current.filter((item) => assetKey(item)!==assetKey(plan)))
    } catch {}
  }

  function navigateToTool(nextView, elementId) {
    navigateView(nextView)
    setMenuOpen(false)
    window.setTimeout(() => {
      const target = document.getElementById(elementId)
      for (let parent = target; parent; parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS') parent.open = true
      }
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 120)
  }

  function closeDrawer() {
    setActiveDrawer('')
  }

  function openHistoryScan(entry) {
    const address = entry?.address
    if (!address) return
    navigateView('scanner')
    setTokenAddress(address)
    runScan({ address, chain:entry?.chain || 'auto' })
  }

  function toggleWatch(item) {
    const address = item?.address || item?.mint
    if (!address) return
    const chain = itemChainId(item,'solana')
    const key = assetKey({address,chain})

    setWatchlist((current) => {
      const exists = current.some((coin) => assetKey(coin) === key)
      const next = exists
        ? current.filter((coin) => assetKey(coin) !== key)
        : [{
            address,
            chain,
            chainLabel:item?.chain?.label || item?.chainLabel || chain,
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
    const chain = itemChainId(item,'solana')
    const key = assetKey({address,chain})

    setCompare((current) => {
      if (current.some((coin) => assetKey(coin) === key)) {
        return current.filter((coin) => assetKey(coin) !== key)
      }
      if (current.length >= 4) {
        setNotificationStatus('Compare supports up to 4 tokens at once.')
        return current
      }
      return [...current, { ...item, address, chain }]
    })
  }

  function exportRadarCsv() {
    const rows = [
      ['symbol','name','address','score','signal','risk','trenchScore','trenchState','ageHours','tx5m','buyPct5m','priceUsd','marketCap','liquidityUsd','volume24h','change24h'],
      ...visibleRadar.map((item) => [
        item.symbol,item.name,item.address,item.intelligence?.score,item.intelligence?.signal,item.intelligence?.risk,
        item.trenchScore,item.trenchState,item.ageHours,item.tx5m,item.buyPct5m,
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

  function exportTradePlansCsv() {
    if (!tradePlans.length) return
    const rows = [
      ['token','name','chain','address','status','positionUsd','entryMarketCap','tpPercent','scaleOutPercent','stopPercent','enteredAt','closedAt','exitMarketCap','estimatedExitValue','estimatedPnl','thesis','invalidation'],
      ...tradePlans.map((plan) => [
        plan.token || '',
        plan.name || '',
        itemChainId(plan,'solana'),
        plan.address || '',
        plan.status || 'DRAFT',
        plan.investment ?? '',
        plan.entryMarketCap ?? '',
        plan.takeProfitPercent ?? '',
        plan.scaleOutPercent ?? '',
        plan.stopDistance ?? '',
        plan.enteredAt ? new Date(plan.enteredAt).toISOString() : '',
        plan.closedAt ? new Date(plan.closedAt).toISOString() : '',
        plan.exitMarketCap ?? '',
        plan.exitValue ?? '',
        plan.exitPnl ?? '',
        plan.thesis || '',
        plan.invalidation || '',
      ]),
    ]
    downloadCsv('rcxt-trade-plans.csv', rows)
  }

  const hiddenAddresses = useMemo(
    () => new Set(hiddenCoins.map((coin) => coin.address)),
    [hiddenCoins],
  )

  const watchKeys = useMemo(
    () => new Set(watchlist.map((coin) => assetKey(coin))),
    [watchlist],
  )

  const visibleRadar = useMemo(() => {
    const query = radarSearch.trim().toLowerCase()
    const filtered = radar.filter((item) => {
      if (hiddenAddresses.has(item.address)) return false
      if (radarPreset === 'new' && (item.ageHours == null || Number(item.ageHours) > 24)) return false
      if (radarPreset === 'trench' && (item.ageHours == null || Number(item.ageHours) > 6)) return false
      if (query && !`${item.symbol} ${item.name} ${item.address}`.toLowerCase().includes(query)) return false
      if (signalFilter !== 'ALL' && item.intelligence?.signal !== signalFilter) return false
      if (Number(item.intelligence?.score || 0) < Number(minScore || 0)) return false
      if (Number(minLiquidity || 0) > 0) {
        const liquidityKnown=item.intelligence?.liquidityReported !== false && item.liquidityUsd != null
        if (liquidityKnown && Number(item.liquidityUsd) < Number(minLiquidity)) return false
        if (!liquidityKnown && !['trench','new','discovery'].includes(radarPreset)) return false
      }
      return true
    })

    const sorters = {
      score: (a,b) => Number(b.intelligence?.score || 0) - Number(a.intelligence?.score || 0),
      discovery: (a,b) => Number(b.discoveryScore || 0) - Number(a.discoveryScore || 0),
      trench: (a,b) => Number(b.trenchScore || 0) - Number(a.trenchScore || 0),
      newest: (a,b) => {
        const aAge = a.ageHours == null ? Number.POSITIVE_INFINITY : Number(a.ageHours)
        const bAge = b.ageHours == null ? Number.POSITIVE_INFINITY : Number(b.ageHours)
        return aAge - bAge
      },
      volume: (a,b) => Number(b.volume24h || 0) - Number(a.volume24h || 0),
      liquidity: (a,b) => {
        const aLiq=a.liquidityUsd == null ? -1 : Number(a.liquidityUsd)
        const bLiq=b.liquidityUsd == null ? -1 : Number(b.liquidityUsd)
        return bLiq-aLiq
      },
      momentum: (a,b) => Number(b.change1h || 0) - Number(a.change1h || 0),
      marketCap: (a,b) => Number(b.marketCap || 0) - Number(a.marketCap || 0),
    }
    return [...filtered].sort(sorters[radarSort] || sorters.score)
  }, [radar, hiddenAddresses, radarSearch, signalFilter, minScore, minLiquidity, radarSort, radarPreset])

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
    const highRiskValue = holdings
      .filter((item) => ['HIGH','EXTREME'].includes(item.intelligence?.risk))
      .reduce((sum,item)=>sum+Number(item.valueUsd||0),0)
    const liquidityKnown=(item)=>item?.intelligence?.liquidityReported !== false && item?.liquidityUsd != null
    const liquidValue = holdings
      .filter((item) => liquidityKnown(item) && Number(item.liquidityUsd) >= 10000)
      .reduce((sum, item) => sum + Number(item.valueUsd || 0), 0)
    const lowLiquidityValue = holdings
      .filter((item) => Number(item.valueUsd || 0) > 0 && liquidityKnown(item) && Number(item.liquidityUsd) < 5000)
      .reduce((sum,item)=>sum+Number(item.valueUsd||0),0)
    const unknownLiquidityValue = holdings
      .filter((item) => Number(item.valueUsd || 0) > 0 && !liquidityKnown(item))
      .reduce((sum,item)=>sum+Number(item.valueUsd||0),0)
    const scoredValue = holdings
      .filter((item)=>Number(item.valueUsd||0)>0 && Number.isFinite(Number(item.intelligence?.score)))
      .reduce((sum,item)=>sum+Number(item.valueUsd||0),0)
    const weightedScore = scoredValue > 0
      ? holdings.reduce((sum,item)=>{
          const value=Number(item.valueUsd||0)
          const score=Number(item.intelligence?.score)
          return Number.isFinite(score)?sum+value*score:sum
        },0)/scoredValue
      : null
    const highRiskValuePercent = total > 0 ? (highRiskValue / total) * 100 : 0
    const lowLiquidityValuePercent = total > 0 ? (lowLiquidityValue / total) * 100 : 0
    const unknownLiquidityValuePercent = total > 0 ? (unknownLiquidityValue / total) * 100 : 0
    const portfolioRisk =
      concentration >= 65 || highRiskValuePercent >= 60 || lowLiquidityValuePercent >= 60 ? 'HIGH' :
      unknownLiquidityValuePercent >= 50 ? 'DATA LIMITED' :
      concentration >= 40 || highRiskValuePercent >= 30 || lowLiquidityValuePercent >= 35 || unknownLiquidityValuePercent >= 25 ? 'MODERATE' :
      total > 0 ? 'LOWER' : 'UNKNOWN'

    return {
      concentration,
      highRisk,
      highRiskValuePercent,
      lowLiquidityValuePercent,
      unknownLiquidityValuePercent,
      weightedScore,
      portfolioRisk,
      liquidPercent: total > 0 ? (liquidValue / total) * 100 : 0,
      largestSymbol: largest?.symbol || '—',
    }
  }, [walletData])

  const portfolioStress = useMemo(() => {
    const holdings = walletData?.holdings || []
    const solValue = Number(walletData?.solValueUsd || 0)
    const tokenValue = Number(walletData?.portfolioTokenValueUsd || 0)
    const totalValue = Number(walletData?.portfolioTotalUsd ?? (solValue + tokenValue))
    const priced = holdings.filter((item) => Number(item.valueUsd || 0) > 0)
    const largest = priced.reduce(
      (best,item) => Number(item.valueUsd || 0) > Number(best?.valueUsd || 0) ? item : best,
      null,
    )
    const highRiskValue = priced
      .filter((item) => ['HIGH','EXTREME'].includes(item.intelligence?.risk))
      .reduce((sum,item) => sum + Number(item.valueUsd || 0), 0)

    function marketShock(percent) {
      const loss = tokenValue * (percent / 100)
      return {
        label: `Tokens -${percent}%`,
        endValue: Math.max(0, totalValue - loss),
        loss,
        percentLoss: totalValue > 0 ? (loss / totalValue) * 100 : 0,
      }
    }

    const largestLoss = Number(largest?.valueUsd || 0)
    const highRiskLoss = highRiskValue * 0.5

    return {
      scenarios: [
        marketShock(10),
        marketShock(25),
        marketShock(50),
        {
          label: 'Largest → $0',
          endValue: Math.max(0, totalValue - largestLoss),
          loss: largestLoss,
          percentLoss: totalValue > 0 ? (largestLoss / totalValue) * 100 : 0,
        },
        {
          label: 'High-risk -50%',
          endValue: Math.max(0, totalValue - highRiskLoss),
          loss: highRiskLoss,
          percentLoss: totalValue > 0 ? (highRiskLoss / totalValue) * 100 : 0,
        },
      ],
      solValue,
      tokenValue,
      totalValue,
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

  const tradePlanStats = useMemo(() => {
    const open = tradePlans.filter((plan) => plan.status === 'OPEN')
    const closed = tradePlans.filter((plan) => plan.status === 'CLOSED')
    const draft = tradePlans.filter((plan) => !plan.status || plan.status === 'DRAFT')
    const outcomes = closed
      .map((plan) => Number(plan.exitPnl))
      .filter((value) => Number.isFinite(value))

    const totalPnl = outcomes.reduce((sum, value) => sum + value, 0)
    const positive = outcomes.filter((value) => value > 0).length
    const negative = outcomes.filter((value) => value < 0).length

    return {
      open: open.length,
      closed: closed.length,
      draft: draft.length,
      positive,
      negative,
      totalPnl,
      averagePnl: outcomes.length ? totalPnl / outcomes.length : null,
      outcomeCount: outcomes.length,
    }
  }, [tradePlans])

  return (
    <main className="appShell">
      <header className="topbar">
        <button className="brand" onClick={() => navigateView('radar')} aria-label="Open radar">
          <span className="brandMark"><i /><i /><i /></span>
          <span>
            <b>RCXT</b>
            <em>RADAR</em>
          </span>
        </button>

        <nav className="desktopNav">
          <NavButton active={view === 'radar'} onClick={() => navigateView('radar')}>Radar</NavButton>
          <NavButton active={view === 'scanner'} onClick={() => navigateView('scanner')}>Scanner</NavButton>
          <NavButton active={view === 'wallet'} onClick={() => navigateView('wallet')}>Wallet</NavButton>
        </nav>

        <div className="topActions">
          <div className="commandMenuWrap">
            <button
              className={menuOpen ? 'menuButton active' : 'menuButton'}
              onClick={() => setMenuOpen((value) => !value)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <span className="menuIcon"><i /><i /><i /></span>
              Menu
            </button>

            {menuOpen ? (
              <div className="commandMenu" role="menu">
                <div className="commandMenuHead">
                  <div>
                    <span>RCXT COMMAND CENTER</span>
                    <strong>Everything in one place</strong>
                  </div>
                  <button onClick={() => setMenuOpen(false)} aria-label="Close menu">×</button>
                </div>

                <div className="commandSection">
                  <span>NAVIGATE</span>
                  <div className="commandGrid three">
                    <button onClick={() => { navigateView('radar') }}><b>Radar</b><small>Live opportunities</small></button>
                    <button onClick={() => { navigateView('scanner') }}><b>Scanner</b><small>Deep token intel</small></button>
                    <button onClick={() => { navigateView('wallet') }}><b>Wallet</b><small>Portfolio command</small></button>
                  </div>
                </div>

                <div className="commandSection">
                  <span>WORKSPACE</span>
                  <div className="commandGrid">
                    <button onClick={() => openDrawer('watchlist')}><b>★ Watchlist</b><small>{watchlist.length} saved tokens</small></button>
                    <button onClick={() => openDrawer('hidden')}><b>Hidden Coins</b><small>{hiddenCoins.length} filtered out</small></button>
                    <button onClick={() => openDrawer('history')}><b>Recent Scans</b><small>{history.length} local scans</small></button>
                    <button onClick={() => openDrawer('plans')}><b>Trade Plans</b><small>{tradePlans.length} draft / open / closed</small></button>
                    <button onClick={() => openDrawer('system')}><b>System Health</b><small>{health?.healthy === false ? 'Needs attention' : 'All systems live'}</small></button>
                    <button onClick={() => navigateToTool('scanner','v4-market-lab')}><b>Market Lab</b><small>Chart · forecast · flow · profit math</small></button>
                    <button onClick={() => navigateToTool('wallet','challenge-tracker')}><b>$5 → $50K</b><small>Wallet equity challenge tracker</small></button>
                    <button onClick={() => openDrawer('alerts')}><b>Alert Center</b><small>Key alerts · anti-spam · thresholds</small></button>
                    <button onClick={() => { exportRadarCsv(); setMenuOpen(false) }}><b>Export Center</b><small>Download radar CSV</small></button>
                  </div>
                </div>

                <div className="commandSection">
                  <span>RADAR PRESETS</span>
                  <div className="presetRow five">
                    <button className={radarPreset === 'trench' ? 'active trenchPreset' : 'trenchPreset'} onClick={() => applyRadarPreset('trench')}>Trench</button>
                    <button className={radarPreset === 'new' ? 'active' : ''} onClick={() => applyRadarPreset('new')}>New</button>
                    <button className={radarPreset === 'safer' ? 'active' : ''} onClick={() => applyRadarPreset('safer')}>Safer</button>
                    <button className={radarPreset === 'balanced' ? 'active' : ''} onClick={() => applyRadarPreset('balanced')}>Balanced</button>
                    <button className={radarPreset === 'discovery' ? 'active' : ''} onClick={() => applyRadarPreset('discovery')}>Discovery</button>
                  </div>
                </div>

                <div className="commandComingSoon xReady">
                  <div>
                    <span>V6 LIVE</span>
                    <strong>X Intelligence</strong>
                    <small>Name · ticker · contract search + AI feed report</small>
                  </div>
                  <b>X ONLY</b>
                </div>

                <div className="commandFooter">
                  <button onClick={resetRadarWorkspace}>Reset radar workspace</button>
                  <span>v6.1 · multichain intelligence + simple verdicts</span>
                </div>
              </div>
            ) : null}
          </div>

          <button
            className={liveMonitor.enabled ? 'liveMonitorButton active' : 'liveMonitorButton inactive'}
            onClick={liveMonitor.enabled ? disableLiveMonitor : enableLiveMonitor}
            disabled={liveMonitor.loading}
            title={liveMonitor.enabled ? 'Background wallet monitoring is active' : 'Background wallet monitoring is off'}
          >
            <span className="liveMonitorDot" />
            {liveMonitor.loading ? 'CHECKING…' : liveMonitor.enabled ? 'LIVE ACTIVE' : 'LIVE OFF'}
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

      <section className={view === 'scanner' && scan ? 'hero heroAfterScan' : 'hero'}>
        <div>
          <span className="overline">MARKET INTELLIGENCE TERMINAL</span>
          <h1>Trade the data.<br /><span>Not the emotion.</span></h1>
          <p>
            Multichain token scanning, Solana wallet tracking, contract-risk checks, order-flow analysis,
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
            <span>Risk-adjusted Score Engine 5.0</span>
            <small>No mock market data</small>
          </div>
        </div>
      </section>

      {notificationStatus ? (
        <div className="notificationStatus" onClick={() => setNotificationStatus('')}>
          {notificationStatus}
        </div>
      ) : null}

      {activeDrawer ? (
        <div className="drawerBackdrop" onClick={closeDrawer}>
          <aside className="workspaceDrawer" onClick={(event) => event.stopPropagation()} aria-label="RCXT workspace drawer">
            <div className="drawerHead">
              <div>
                <span>RCXT WORKSPACE</span>
                <h3>
                  {activeDrawer === 'watchlist' ? 'Watchlist' :
                   activeDrawer === 'hidden' ? 'Hidden Coins' :
                   activeDrawer === 'history' ? 'Recent Scans' :
                   activeDrawer === 'plans' ? 'Trade Plans' :
                   activeDrawer === 'alerts' ? 'Alert Center' : 'System Health'}
                </h3>
              </div>
              <button onClick={closeDrawer} aria-label="Close drawer">×</button>
            </div>

            {activeDrawer === 'watchlist' ? (
              <div className="drawerList">
                {watchlist.length ? watchlist.map((coin) => (
                  <button key={assetKey(coin)} onClick={() => openRadarToken(coin)}>
                    <div><strong>{coin.symbol}</strong><span>{coin.name} · {coin.chainLabel || itemChainId(coin)}</span></div>
                    <small>{shortAddress(coin.address, 5)} →</small>
                  </button>
                )) : <EmptyDrawer text="Nothing watched yet. Tap ☆ on a radar card or scanner." />}
              </div>
            ) : null}

            {activeDrawer === 'hidden' ? (
              <>
                <div className="drawerToolbar">
                  <span>{hiddenCoins.length} hidden</span>
                  {hiddenCoins.length ? <button onClick={restoreAllCoins}>Restore all</button> : null}
                </div>
                <div className="drawerList">
                  {hiddenCoins.length ? hiddenCoins.map((coin) => (
                    <div className="drawerRow" key={coin.address}>
                      <div><strong>{coin.symbol || 'TOKEN'}</strong><span>{coin.name || shortAddress(coin.address, 5)}</span></div>
                      <button onClick={() => restoreCoin(coin.address)}>Restore</button>
                    </div>
                  )) : <EmptyDrawer text="No hidden coins. Hide noisy tokens from Radar or Scanner." />}
                </div>
              </>
            ) : null}

            {activeDrawer === 'history' ? (
              <div className="drawerList">
                {history.length ? history.map((entry, index) => (
                  <button key={`${entry.chain || 'solana'}:${entry.address}-${index}`} onClick={() => openHistoryScan(entry)}>
                    <div><strong>{entry.symbol || 'TOKEN'}</strong><span>{entry.chainLabel || entry.chain || 'solana'} · {entry.signal || 'Saved scan'}</span></div>
                    <small>{entry.score ?? '—'}/100 →</small>
                  </button>
                )) : <EmptyDrawer text="No recent scans yet. Manual token scans appear here." />}
              </div>
            ) : null}

            {activeDrawer === 'plans' ? (
              <>
                <div className="drawerToolbar">
                  <span>{tradePlans.length} saved plans</span>
                  <button onClick={exportTradePlansCsv} disabled={!tradePlans.length}>Export CSV</button>
                </div>
                <div className="tradePlanLibraryStats">
                  <div><span>Open</span><b>{tradePlanStats.open}</b></div>
                  <div><span>Closed</span><b>{tradePlanStats.closed}</b></div>
                  <div><span>Positive / Negative</span><b><i className="positiveText">{tradePlanStats.positive}</i> / <i className="negativeText">{tradePlanStats.negative}</i></b></div>
                  <div><span>Est. total P/L</span><b className={tradePlanStats.totalPnl >= 0 ? 'positiveText' : 'negativeText'}>{usd(tradePlanStats.totalPnl)}</b></div>
                  <div><span>Avg closed P/L</span><b>{tradePlanStats.averagePnl == null ? '—' : usd(tradePlanStats.averagePnl)}</b></div>
                  <div><span>Drafts</span><b>{tradePlanStats.draft}</b></div>
                </div>
                <small className="tradePlanStatsNote">Journal P/L is estimated from saved market-cap math, not exchange-verified realized P/L.</small>
                <div className="tradePlanLibrary">
                  {tradePlans.length ? tradePlans.map((plan) => (
                    <div className="tradePlanLibraryRow" key={assetKey(plan)}>
                      <button className="tradePlanOpen" onClick={() => openTradePlan(plan)}>
                        <div>
                          <strong>{plan.token || shortAddress(plan.address, 5)}</strong>
                          <span>{plan.name || shortAddress(plan.address, 6)}</span>
                        </div>
                        <div className="tradePlanLibraryMeta">
                          <b className={
                            plan.status === 'OPEN' ? 'open' :
                            plan.status === 'CLOSED' ? (Number(plan.exitPnl || 0) >= 0 ? 'closedGood' : 'closedBad') :
                            'draft'
                          }>{plan.status || 'DRAFT'}</b>
                          <small>{plan.investment ? usd(plan.investment) : '—'} · Entry {plan.entryMarketCap ? compactUsd(plan.entryMarketCap) : '—'}</small>
                          {plan.status === 'CLOSED' && plan.exitPnl != null ? (
                            <small className={Number(plan.exitPnl) >= 0 ? 'positiveText' : 'negativeText'}>
                              Est. P/L {usd(plan.exitPnl)}
                            </small>
                          ) : null}
                        </div>
                      </button>
                      <button className="tradePlanDelete" onClick={() => deleteTradePlan(plan)} aria-label={'Delete ' + (plan.token || 'trade plan')}>×</button>
                    </div>
                  )) : <EmptyDrawer text="No trade plans yet. Save one from the V4 Market Lab." />}
                </div>
              </>
            ) : null}

            {activeDrawer === 'alerts' ? (
              <NotificationCenter
                prefs={notificationPrefs}
                onChange={saveNotificationPreferences}
                liveMonitor={liveMonitor}
                onToggleServerMonitor={liveMonitor.enabled ? disableLiveMonitor : enableLiveMonitor}
                scoreTarget={alertScore}
                onScoreTarget={(value)=>{setAlertScore(value);saveAlertRules({score:value})}}
                marketCapTarget={alertMarketCap}
                onMarketCapTarget={(value)=>{setAlertMarketCap(value);saveAlertRules({marketCap:value})}}
              />
            ) : null}

            {activeDrawer === 'system' ? (
              <div className="systemDrawerGrid">
                <ServiceTile label="RCXT App" service={health?.services?.app} />
                <ServiceTile label="Solana RPC" service={health?.services?.solana} />
                <ServiceTile label="DexScreener" service={health?.services?.dexscreener} />
                <ServiceTile label="Charts / Tape" service={health?.services?.charts} />
                <ServiceTile label="Supabase" service={health?.services?.supabase} />
                <div className="systemMeta"><span>Score engine</span><b>{health?.scoreVersion || '5.0.0'}</b></div>
                <div className="systemMeta"><span>Secure writes</span><b>{health?.oidc?.available ? 'OIDC ACTIVE' : 'CHECKING'}</b></div>
                <div className="systemMeta"><span>Scanner</span><b>15 seconds</b></div>
                <div className="systemMeta"><span>Radar</span><b>10 seconds</b></div>
              </div>
            ) : null}

            <div className="drawerFoot">
              <span>Saved workspace data stays on this device.</span>
              <button onClick={closeDrawer}>Done</button>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="mobileNav">
        <NavButton active={view === 'radar'} onClick={() => navigateView('radar')}>Radar</NavButton>
        <NavButton active={view === 'scanner'} onClick={() => navigateView('scanner')}>Scanner</NavButton>
        <NavButton active={view === 'wallet'} onClick={() => navigateView('wallet')}>Wallet</NavButton>
      </div>

      {view === 'radar' && (
        <section className="contentStack">
          <div className="sectionHeading">
            <div>
              <span className="sectionNumber">01</span>
              <div>
                <h2>Opportunity Radar</h2>
                <p>Fresh launches + active Solana markets ranked by RCXT quality, liquidity, activity, and age.</p>
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

          {radarPreset === 'trench' ? (
            <div className="trenchModeBanner">
              <div>
                <span>TRENCH MODE</span>
                <strong>Fresh-pair execution view</strong>
                <small>≤6h pairs · 5m flow · liquidity floor · main RCXT risk gates stay active</small>
              </div>
              <div className="trenchLegend">
                <span><i className="hot" /> HOT</span>
                <span><i className="active" /> ACTIVE</span>
                <span><i className="risk" /> SELLERS / EXTENDED</span>
              </div>
            </div>
          ) : null}

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
              <option value="trench">Sort: Trench Score</option>
              <option value="discovery">Sort: Early Discovery</option>
              <option value="newest">Sort: Newest</option>
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
                    <button key={assetKey(coin)} onClick={() => openRadarToken(coin)}>
                      <strong>{coin.symbol}</strong>
                      <span>{coin.name} · {coin.chainLabel || itemChainId(coin)}</span>
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
                  className={radarPreset === 'trench' ? 'radarCard trenchCard' : 'radarCard'}
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
                        className={watchKeys.has(assetKey(item,'solana')) ? 'watchButton active' : 'watchButton'}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleWatch(item)
                        }}
                        aria-label={watchKeys.has(assetKey(item,'solana')) ? `Remove ${item.symbol} from watchlist` : `Watch ${item.symbol}`}
                      >
                        {watchKeys.has(assetKey(item,'solana')) ? '★' : '☆'}
                      </button>
                      <button
                        className={compare.some((coin) => assetKey(coin) === assetKey(item,'solana')) ? 'compareButton active' : 'compareButton'}
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
                      {item.pumpFunUrl ? (
                        <a
                          className="pumpButton"
                          href={item.pumpFunUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          Pump.fun ↗
                        </a>
                      ) : null}
                      <SignalBadge signal={item.intelligence.signal} />
                    </div>
                  </div>
                  <div className="tokenName">
                    <strong>{item.symbol}</strong>
                    <span>{item.name}</span>
                    {item.ageHours != null ? (
                      <em className={item.isNew ? 'ageBadge new' : 'ageBadge'}>
                        {item.freshnessBand} · {formatAge(item.ageHours)}
                      </em>
                    ) : null}
                  </div>
                  {radarPreset === 'trench' ? (
                    <div className="trenchStrip">
                      <div>
                        <span>TRENCH SCORE</span>
                        <strong>{item.trenchScore ?? '—'}</strong>
                      </div>
                      <div>
                        <span>STATE</span>
                        <strong className={`trenchState ${String(item.trenchState || '').toLowerCase()}`}>{item.trenchState || '—'}</strong>
                      </div>
                      <div>
                        <span>5M FLOW</span>
                        <strong>{item.tx5m ?? 0} tx · {item.buyPct5m ?? 50}% buys</strong>
                      </div>
                    </div>
                  ) : null}
                  <div className="scoreLine">
                    <ScoreRing score={item.intelligence.score} />
                    <div>
                      <small>RCXT RISK-ADJUSTED SCORE</small>
                      <b>{item.intelligence.grade} · {item.intelligence.confidence}% evidence confidence</b>
                    </div>
                  </div>
                  <ScoreAxes intelligence={item.intelligence} compact />
                  <div className="miniMetrics">
                    <Metric label="MC" value={compactUsd(item.marketCap)} />
                    <Metric label="LIQ" value={compactUsd(item.liquidityUsd)} />
                    <Metric label="DISCOVERY" value={item.discoveryScore ? `${item.discoveryScore}/100` : '—'} />
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
            <div><span>06</span><b>Contract</b><small>Chain-specific controls</small></div>
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
                <p>Scan Solana or supported EVM contracts with chain-aware market and security checks.</p>
              </div>
            </div>
            <label className="autoToggle">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              <span />
              15S AUTO
            </label>
          </div>

          <div className="scanBar multiChain">
            <select
              className="chainSelect"
              value={scanChain}
              onChange={(event) => setScanChain(event.target.value)}
              aria-label="Token blockchain"
            >
              {SCAN_CHAIN_OPTIONS.map((chain) => (
                <option key={chain.id} value={chain.id}>{chain.label}</option>
              ))}
            </select>
            <input
              value={tokenAddress}
              onChange={(event) => setTokenAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') runScan()
              }}
              placeholder="Paste token contract address"
              aria-label="Token contract address"
            />
            <button className="primaryButton" onClick={() => runScan()} disabled={scanLoading}>
              {scanLoading ? 'ANALYZING…' : 'SCAN TOKEN'}
            </button>
          </div>

          {scanError ? <ErrorBox text={scanError} /> : null}

          {scan ? (
            <>
              <ScanVerdict scan={scan} />
              <div className="scanQuickActions">
                <button className={watchKeys.has(assetKey(scan)) ? 'toolButton active' : 'toolButton'} onClick={() => toggleWatch(scan)}>
                  {watchKeys.has(assetKey(scan)) ? '★ Watching' : '☆ Watch'}
                </button>
                <button className="toolButton" onClick={() => navigator.clipboard?.writeText(scan.address)}>Copy CA</button>
                {scan?.chain?.id === 'solana' ? (
                  <button
                    className="toolButton bubbleMapButton"
                    onClick={() => window.open(
                      `https://v2.bubblemaps.io/map?address=${encodeURIComponent(scan.address)}&chain=solana&partnerId=regular`,
                      '_blank',
                      'noopener,noreferrer',
                    )}
                    title="Open this token in Bubblemaps V2"
                  >
                    Bubble Map ↗
                  </button>
                ) : scan?.chain?.explorerUrl ? (
                  <a className="toolLink chainExplorerLink" href={scan.chain.explorerUrl} target="_blank" rel="noreferrer">
                    Explorer ↗
                  </a>
                ) : null}
                <details className="scanMoreActions">
                  <summary>More</summary>
                  <div>
                    <button className="toolButton" onClick={shareCurrentToken}>Share</button>
                    <button
                      className={hiddenAddresses.has(scan.address) ? 'toolButton active' : 'toolButton dangerSoft'}
                      onClick={() => {
                        if (hiddenAddresses.has(scan.address)) {
                          restoreCoin(scan.address)
                          setNotificationStatus(`${scan.token?.symbol || 'Token'} restored to Radar.`)
                        } else {
                          hideCoin({ address:scan.address, symbol:scan.token?.symbol, name:scan.token?.name })
                          setNotificationStatus(`${scan.token?.symbol || 'Token'} hidden from Radar.`)
                        }
                      }}
                    >
                      {hiddenAddresses.has(scan.address) ? 'Restore Coin' : 'Hide Coin'}
                    </button>
                    {scan.pair?.url ? <a className="toolLink" href={scan.pair.url} target="_blank" rel="noreferrer">DexScreener ↗</a> : null}
                    {scan?.chain?.explorerUrl ? <a className="toolLink" href={scan.chain.explorerUrl} target="_blank" rel="noreferrer">{scan.chain.label || 'Chain'} Explorer ↗</a> : null}
                    {isPumpFunToken(scan) ? (
                      <a className="toolLink pumpLink" href={`https://pump.fun/coin/${scan.address}`} target="_blank" rel="noreferrer">
                        Pump.fun ↗
                      </a>
                    ) : null}
                  </div>
                </details>
              </div>

              <details className="quickReadDisclosure">
                <summary>
                  <div>
                    <span>WHY THIS RESULT</span>
                    <strong>Reasons + scenario map</strong>
                    <small>Open only when you want the deeper explanation.</small>
                  </div>
                  <b>OPEN</b>
                </summary>
                <BeginnerSnapshot scan={scan} />
              </details>

              <details className="coreMetricsDisclosure">
                <summary>
                  <div>
                    <span>MARKET DATA</span>
                    <strong>{compactUsd(scan.market.marketCap)} MC · {percent(scan.market.priceChange.h24)} 24H · {compactUsd(scan.market.volume.h24)} VOL</strong>
                  </div>
                  <b>OPEN</b>
                </summary>
                <div className="metricGrid six">
                  <MetricCard label="Price" value={tinyUsd(scan.market.priceUsd)} />
                  <MetricCard label="Market Cap" value={compactUsd(scan.market.marketCap)} />
                  <MetricCard label="Liquidity" value={scan.intelligence.liquidityReported === false ? 'N/A' : compactUsd(scan.market.liquidityUsd)} />
                  <MetricCard label="24H Volume" value={compactUsd(scan.market.volume.h24)} />
                  <MetricCard
                    label="24H Change"
                    value={percent(scan.market.priceChange.h24)}
                    tone={scan.market.priceChange.h24 >= 0 ? 'positive' : 'negative'}
                  />
                  <MetricCard label="24H Buy %" value={`${scan.intelligence.buyPercent24h}%`} />
                </div>
              </details>

              <details className="advancedDisclosure" key={scan.address}>
                <summary>
                  <div>
                    <span>ADVANCED DATA</span>
                    <strong>Explore one section at a time</strong>
                    <small>Tap a section below for scores, charts, risk checks or trade tools.</small>
                  </div>
                  <b>OPEN</b>
                </summary>
                <div className="advancedDisclosureBody">
              <DetailSection title="Score & history" description="Score axes, recent changes and model validation">
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
                <SnapshotDelta
                  rows={scoreHistory}
                  current={{
                    score:scan.intelligence.score,
                    signal:scan.intelligence.signal,
                    priceUsd:scan.market.priceUsd,
                    marketCap:scan.market.marketCap,
                    liquidityUsd:scan.market.liquidityUsd,
                    volume24h:scan.market.volume.h24,
                    setupScore:scan.intelligence.setupScore,
                    executionScore:scan.intelligence.executionScore,
                    safetyScore:scan.intelligence.safetyScore,
                    dataQualityScore:scan.intelligence.dataQualityScore,
                  }}
                  modelVersion={scan.intelligence.modelVersion}
                />
                <CalibrationStrip
                  calibration={calibration}
                  modelVersion={scan.intelligence.modelVersion}
                  signal={scan.intelligence.signal}
                  score={scan.intelligence.score}
                />
              </article>
              </DetailSection>
              <DetailSection title="X intelligence" description="Social activity and connection status">
              <XSocialIntel scan={scan} notificationsEnabled={notificationsEnabled} notificationPrefs={notificationPrefs} />
              </DetailSection>
              <DetailSection title="Contract & trade thesis" description="Risk flags, supporting evidence and invalidation">
              <div className="analysisGrid">
                <article className="panel scorePanel">
                  <PanelHeader eyebrow="SIGNAL ENGINE" title="Why the score moved" />
                  <ScoreBreakdown breakdown={scan.intelligence.breakdown} />
                </article>

                <article className="panel">
                  <PanelHeader eyebrow="RISK CONTROL" title="Contract + market flags" />
                  <div className="securityRows">
                    {scan.security?.securityModel === 'evm-token' ? (
                      <>
                        <SecurityRow
                          label="Contract bytecode"
                          good={scan.security?.contractCodePresent === true}
                          unknown={!scan.security?.available || scan.security?.contractCodePresent == null}
                          value={
                            !scan.security?.available
                              ? 'RPC unavailable'
                              : scan.security?.contractCodePresent
                                ? 'Present'
                                : 'Not found'
                          }
                        />
                        <SecurityRow
                          label="Open source"
                          good={scan.security?.external?.goplus?.openSource === true}
                          unknown={scan.security?.external?.goplus?.openSource == null}
                          value={
                            scan.security?.external?.goplus?.openSource === true
                              ? 'Verified source'
                              : scan.security?.external?.goplus?.openSource === false
                                ? 'Closed source'
                                : 'Unknown'
                          }
                        />
                        <SecurityRow
                          label="Honeypot"
                          good={scan.security?.external?.goplus?.honeypot === false}
                          unknown={scan.security?.external?.goplus?.honeypot == null}
                          value={
                            scan.security?.external?.goplus?.honeypot === true
                              ? 'DETECTED'
                              : scan.security?.external?.goplus?.honeypot === false
                                ? 'Not detected'
                                : 'Unknown'
                          }
                        />
                        <SecurityRow
                          label="Buy / sell tax"
                          good={
                            Math.max(
                              Number(scan.security?.external?.goplus?.buyTaxPercent || 0),
                              Number(scan.security?.external?.goplus?.sellTaxPercent || 0),
                            ) < 10
                          }
                          unknown={
                            scan.security?.external?.goplus?.buyTaxPercent == null &&
                            scan.security?.external?.goplus?.sellTaxPercent == null
                          }
                          value={
                            scan.security?.external?.goplus?.buyTaxPercent == null &&
                            scan.security?.external?.goplus?.sellTaxPercent == null
                              ? 'Unknown'
                              : `${fixed(scan.security?.external?.goplus?.buyTaxPercent || 0,1,'0.0')}% / ${fixed(scan.security?.external?.goplus?.sellTaxPercent || 0,1,'0.0')}%`
                          }
                        />
                      </>
                    ) : (
                      <>
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
                      </>
                    )}
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
                    {scan.intelligence?.securityEvidence?.token2022?.detected ? (
                      <>
                        <SecurityRow
                          label="Token-2022 controls"
                          good={
                            !scan.intelligence.securityEvidence.token2022.permanentDelegateActive &&
                            !scan.intelligence.securityEvidence.token2022.defaultAccountFrozen &&
                            !scan.intelligence.securityEvidence.token2022.nonTransferable &&
                            !scan.intelligence.securityEvidence.token2022.paused
                          }
                          value={
                            scan.intelligence.securityEvidence.token2022.nonTransferable
                              ? 'Non-transferable'
                              : scan.intelligence.securityEvidence.token2022.paused
                                ? 'Paused'
                                : scan.intelligence.securityEvidence.token2022.permanentDelegateActive
                                  ? 'Permanent delegate'
                                  : scan.intelligence.securityEvidence.token2022.defaultAccountFrozen
                                    ? 'Defaults frozen'
                                    : scan.intelligence.securityEvidence.token2022.transferHookActive
                                      ? 'Transfer hook'
                                      : 'No hard extension veto'
                          }
                        />
                        {scan.intelligence.securityEvidence.token2022.transferFeeEnabled ? (
                          <SecurityRow
                            label="Transfer fee"
                            good={Number(scan.intelligence.securityEvidence.token2022.transferFeeBasisPoints || 0) < 500}
                            unknown={scan.intelligence.securityEvidence.token2022.transferFeeBasisPoints == null}
                            value={
                              scan.intelligence.securityEvidence.token2022.transferFeeBasisPoints == null
                                ? 'Enabled'
                                : `${(Number(scan.intelligence.securityEvidence.token2022.transferFeeBasisPoints) / 100).toFixed(2)}%`
                            }
                          />
                        ) : null}
                      </>
                    ) : null}
                    <SecurityRow
                      label="Security sources"
                      good={Number(scan.intelligence?.securityEvidence?.providerCount || 0) >= 2}
                      unknown={!scan.intelligence?.securityEvidence?.providerCount}
                      value={
                        scan.intelligence?.securityEvidence?.providerCount
                          ? `${scan.intelligence.securityEvidence.providerCount} source${scan.intelligence.securityEvidence.providerCount === 1 ? '' : 's'}`
                          : 'Unavailable'
                      }
                    />
                    <SecurityRow
                      label="Security consensus"
                      good={
                        Number(scan.intelligence?.securityEvidence?.providerCount || 0) >= 2 &&
                        !(scan.intelligence?.securityEvidence?.conflicts || []).length
                      }
                      unknown={Number(scan.intelligence?.securityEvidence?.providerCount || 0) < 2}
                      value={
                        (scan.intelligence?.securityEvidence?.conflicts || []).length
                          ? `${scan.intelligence.securityEvidence.conflicts.length} conflict${scan.intelligence.securityEvidence.conflicts.length === 1 ? '' : 's'}`
                          : Number(scan.intelligence?.securityEvidence?.providerCount || 0) >= 2
                            ? 'Sources agree'
                            : 'Needs corroboration'
                      }
                    />
                    <SecurityRow
                      label="Evidence quality"
                      good={Number(scan.intelligence?.securityEvidence?.evidenceScore || 0) >= 70}
                      unknown={scan.intelligence?.securityEvidence?.evidenceScore == null}
                      value={
                        scan.intelligence?.securityEvidence?.evidenceScore == null
                          ? 'Unavailable'
                          : `${Math.round(Number(scan.intelligence.securityEvidence.evidenceScore))}/100`
                      }
                    />
                    <SecurityRow
                      label="Market sources"
                      good={Number(scan.intelligence?.securityEvidence?.market?.priceProviderCount || 0) >= 3}
                      unknown={!scan.intelligence?.securityEvidence?.market?.priceProviderCount}
                      value={
                        scan.intelligence?.securityEvidence?.market?.priceProviderCount
                          ? `${scan.intelligence.securityEvidence.market.priceProviderCount} price source${scan.intelligence.securityEvidence.market.priceProviderCount === 1 ? '' : 's'}`
                          : 'Dex only'
                      }
                    />
                    <SecurityRow
                      label="Price consensus"
                      good={
                        Number(scan.intelligence?.securityEvidence?.market?.priceProviderCount || 0) >= 2 &&
                        !scan.intelligence?.securityEvidence?.market?.priceConflict
                      }
                      unknown={Number(scan.intelligence?.securityEvidence?.market?.priceProviderCount || 0) < 2}
                      value={
                        scan.intelligence?.securityEvidence?.market?.priceConflict
                          ? `${fixed(scan.intelligence?.securityEvidence?.market?.maxDeviationPercent || 0,1,'0.0')}% source spread`
                          : scan.intelligence?.securityEvidence?.market?.priceAgreement
                            ? 'Strong agreement'
                            : Number(scan.intelligence?.securityEvidence?.market?.priceProviderCount || 0) >= 2
                              ? 'Within tolerance'
                              : 'Needs corroboration'
                      }
                    />
                    {scan.security?.external?.rugcheck?.available ? (
                      <SecurityRow
                        label="RugCheck"
                        good={
                          !scan.intelligence?.securityEvidence?.rugged &&
                          Number(scan.intelligence?.securityEvidence?.dangerRiskCount || 0) === 0
                        }
                        value={
                          scan.intelligence?.securityEvidence?.rugged
                            ? 'Rugged flag'
                            : Number(scan.intelligence?.securityEvidence?.dangerRiskCount || 0) > 0
                              ? `${scan.intelligence.securityEvidence.dangerRiskCount} danger finding${scan.intelligence.securityEvidence.dangerRiskCount === 1 ? '' : 's'}`
                              : 'No danger flags'
                        }
                      />
                    ) : null}
                    {scan.intelligence?.securityEvidence?.jupiterOrganicScore != null ? (
                      <SecurityRow
                        label="Jupiter organic"
                        good={Number(scan.intelligence.securityEvidence.jupiterOrganicScore) >= 55}
                        value={`${Math.round(Number(scan.intelligence.securityEvidence.jupiterOrganicScore))}/100`}
                      />
                    ) : null}
                    <SecurityRow
                      label="Concentration source"
                      good={scan.intelligence?.concentration?.available}
                      unknown={!scan.intelligence?.concentration?.available}
                      value={
                        scan.intelligence?.concentration?.method === 'RESOLVED_TOKEN_ACCOUNT_OWNERS'
                          ? 'Resolved owners'
                          : scan.intelligence?.concentration?.method === 'TOKEN_ACCOUNTS'
                            ? 'Token accounts'
                            : scan.intelligence?.concentration?.method === 'RUGCHECK_TOP_HOLDERS'
                              ? 'RugCheck holders'
                              : scan.intelligence?.concentration?.method === 'GOPLUS_TOP_HOLDERS'
                                ? 'GoPlus holders'
                                : scan.intelligence?.concentration?.method === 'BIRDEYE_TOP_HOLDERS'
                                  ? 'Birdeye holders'
                                  : 'Unavailable'
                      }
                    />
                    <SecurityRow
                      label={
                        scan.intelligence?.concentration?.method === 'RESOLVED_TOKEN_ACCOUNT_OWNERS'
                          ? 'Largest resolved owner'
                          : ['RUGCHECK_TOP_HOLDERS','GOPLUS_TOP_HOLDERS','BIRDEYE_TOP_HOLDERS'].includes(scan.intelligence?.concentration?.method)
                            ? 'Largest external holder'
                            : 'Largest token account'
                      }
                      good={
                        scan.intelligence?.concentration?.available &&
                        Number(scan.intelligence?.concentration?.top1Percent || 100) < 45
                      }
                      unknown={!scan.intelligence?.concentration?.available || scan.intelligence?.concentration?.top1Percent == null}
                      value={
                        scan.intelligence?.concentration?.top1Percent == null
                          ? 'Unavailable'
                          : `${fixed(scan.intelligence.concentration.top1Percent,1)}%`
                      }
                    />
                    <SecurityRow
                      label={
                        scan.intelligence?.concentration?.method === 'RESOLVED_TOKEN_ACCOUNT_OWNERS'
                          ? 'Top 10 resolved owners'
                          : ['RUGCHECK_TOP_HOLDERS','GOPLUS_TOP_HOLDERS','BIRDEYE_TOP_HOLDERS'].includes(scan.intelligence?.concentration?.method)
                            ? 'Top 10 external holders'
                            : 'Top 10 token accounts'
                      }
                      good={
                        scan.intelligence?.concentration?.available &&
                        Number(scan.intelligence?.concentration?.top10Percent || 100) < 85
                      }
                      unknown={!scan.intelligence?.concentration?.available}
                      value={
                        scan.intelligence?.concentration?.available
                          ? `${fixed(scan.intelligence.concentration.top10Percent,1)}%`
                          : 'Unavailable'
                      }
                    />
                    {scan.intelligence?.concentration?.method === 'RESOLVED_TOKEN_ACCOUNT_OWNERS' ? (
                      <>
                        <SecurityRow
                          label="Raw largest token acct"
                          good={Number(scan.intelligence?.concentration?.accountTop1Percent || 100) < 45}
                          unknown={scan.intelligence?.concentration?.accountTop1Percent == null}
                          value={
                            scan.intelligence?.concentration?.accountTop1Percent == null
                              ? 'Unavailable'
                              : `${fixed(scan.intelligence.concentration.accountTop1Percent,1)}%`
                          }
                        />
                        <SecurityRow
                          label="Resolved top owners"
                          good={Number(scan.intelligence?.concentration?.uniqueResolvedOwners || 0) >= 5}
                          unknown={!scan.intelligence?.concentration?.uniqueResolvedOwners}
                          value={
                            scan.intelligence?.concentration?.uniqueResolvedOwners
                              ? String(scan.intelligence.concentration.uniqueResolvedOwners)
                              : 'Unavailable'
                          }
                        />
                      </>
                    ) : null}
                    <SecurityRow
                      label="Liquidity / cap"
                      good={scan.intelligence.liquidityToCapPercent != null && scan.intelligence.liquidityToCapPercent >= 8}
                      unknown={scan.intelligence.liquidityToCapPercent == null}
                      value={
                        scan.intelligence.liquidityToCapPercent == null
                          ? 'Unavailable'
                          : `${scan.intelligence.liquidityToCapPercent}%`
                      }
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

              </DetailSection>
              <DetailSection title="Alerts & notes" description="Notification rules and your private token note">
              <div className="proDetailGrid">
                <article className="panel alertPanel">
                  <PanelHeader eyebrow="ALERT ENGINE" title="Quiet by default · fully configurable" />
                  <button className="alertCenterLaunch" onClick={() => openDrawer('alerts')}>
                    <span>{liveMonitor.enabled ? '24/7 ACTIVE' : '24/7 OFF'}</span>
                    <strong>Open Notification Center</strong>
                    <small>{notificationPrefs.cooldownMinutes}m anti-spam cooldown · key signal changes {notificationPrefs.signalChanges ? 'ON' : 'OFF'}</small>
                  </button>
                  <div className="alertRules compact">
                    <label>
                      <span>Score crosses {notificationPrefs.scoreCrossing ? '· ON' : '· OFF'}</span>
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
                      <span>Market cap crosses ($) {notificationPrefs.marketCapCrossing ? '· ON' : '· OFF'}</span>
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
                        checked={notificationPrefs.signalChanges}
                        onChange={(event) => {
                          saveAlertRules({ signalChanges: event.target.checked })
                          saveNotificationPreferences({...notificationPrefs,signalChanges:event.target.checked})
                        }}
                      />
                      <span>Signal-change alerts</span>
                    </label>
                  </div>
                  <small className="panelHint">Scanner rules run while RCXT is open. Wallet-buy alerts can run in the background when 24/7 Live Monitor is active.</small>
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

              </DetailSection>
              <SectionBoundary name="Market Lab">
                <V4AnalyticsSuite
                  scan={scan}
                  walletEquity={Number(walletData?.portfolioTotalUsd || walletData?.portfolioTokenValueUsd || 0)}
                  onContext={setMarketContext}
                />
              </SectionBoundary>
                </div>
              </details>

              <article className="panel aiPanel">
                <div className="aiHeader">
                  <div>
                    <span className="aiSpark">✦</span>
                    <div>
                      <span className="eyebrow">RCXT AI ANALYST</span>
                      <h3>Explain this setup</h3>
                    </div>
                  </div>
                  <div className="aiModeButtons">
                    <button
                      className={aiMode === 'beginner' ? 'aiButton active' : 'aiButton secondary'}
                      onClick={() => askAI('beginner')}
                      disabled={aiLoading}
                    >
                      {aiLoading && aiMode === 'beginner' ? 'THINKING…' : 'EXPLAIN SIMPLY'}
                    </button>
                    <button
                      className={aiMode === 'pro' ? 'aiButton active' : 'aiButton secondary'}
                      onClick={() => askAI('pro')}
                      disabled={aiLoading}
                    >
                      {aiLoading && aiMode === 'pro' ? 'THINKING…' : 'PRO READ'}
                    </button>
                  </div>
                </div>

                {aiAnalysis ? (
                  <div className="aiResponse">
                    <div className="aiModel">{aiModel} · {aiMode === 'beginner' ? 'BEGINNER' : 'PRO'}</div>
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
                {autoRefresh ? 'Auto-refreshing every 15 seconds' : 'Auto-refresh paused'}
                {lastRefresh ? <small>Last update {lastRefresh.toLocaleTimeString()}</small> : null}
              </div>
            </>
          ) : (
            <EmptyScanner history={history} onSelect={(item) => runScan({ address: item.address, chain:item.chain || 'auto' })} />
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

          <SectionBoundary name="$5 → $50K Challenge">
            <ChallengeTracker walletAddress={wallet} walletData={walletData} />
          </SectionBoundary>
          <WalletActivity
            walletAddress={wallet}
            onOpenToken={openRadarToken}
            notificationsEnabled={notificationsEnabled}
            notificationPrefs={notificationPrefs}
            serverMonitor={liveMonitor}
            onToggleServerMonitor={liveMonitor.enabled ? disableLiveMonitor : enableLiveMonitor}
          />

          {walletData ? (
            <>
              <div className="walletRiskStrip">
                <MetricCard label="Largest Position" value={portfolioStats.largestSymbol} />
                <MetricCard label="Top Concentration" value={`${fixed(portfolioStats.concentration,1,'0.0')}%`} tone={portfolioStats.concentration > 50 ? 'negative' : ''} />
                <MetricCard label="High-Risk Positions" value={portfolioStats.highRisk} tone={portfolioStats.highRisk ? 'negative' : 'positive'} />
                <MetricCard label="High-Risk Value" value={`${fixed(portfolioStats.highRiskValuePercent,0,'0')}%`} tone={portfolioStats.highRiskValuePercent >= 30 ? 'negative' : 'positive'} />
                <MetricCard label="Low-Liq Value" value={`${fixed(portfolioStats.lowLiquidityValuePercent,0,'0')}%`} tone={portfolioStats.lowLiquidityValuePercent >= 35 ? 'negative' : ''} />
                <MetricCard label="Unknown-Liq Value" value={`${fixed(portfolioStats.unknownLiquidityValuePercent,0,'0')}%`} tone={portfolioStats.unknownLiquidityValuePercent >= 50 ? 'negative' : ''} />
                <MetricCard label="Weighted Score" value={portfolioStats.weightedScore == null ? '—' : fixed(portfolioStats.weightedScore,0)} />
                <MetricCard label="Portfolio Risk" value={portfolioStats.portfolioRisk} tone={portfolioStats.portfolioRisk === 'HIGH' ? 'negative' : portfolioStats.portfolioRisk === 'LOWER' ? 'positive' : ''} />
                <MetricCard label="Value in $10K+ Liq" value={`${fixed(portfolioStats.liquidPercent,0,'0')}%`} />
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

              <article className="panel portfolioStressPanel">
                <PanelHeader eyebrow="PORTFOLIO STRESS LAB" title="What-if downside scenarios" />
                <div className="stressIntro">
                  <p>Stress tests keep SOL value unchanged and shock token positions only. They are scenario math—not forecasts.</p>
                  <div><span>Token value</span><b>{usd(portfolioStress.tokenValue)}</b></div>
                  <div><span>SOL cushion</span><b>{usd(portfolioStress.solValue)}</b></div>
                </div>
                <div className="stressGrid">
                  {portfolioStress.scenarios.map((scenario) => (
                    <div className="stressCard" key={scenario.label}>
                      <span>{scenario.label}</span>
                      <strong>{usd(scenario.endValue)}</strong>
                      <b className="negativeText">−{usd(scenario.loss)}</b>
                      <small>{fixed(scenario.percentLoss,1,'0.0')}% of total portfolio</small>
                    </div>
                  ))}
                </div>
                <p className="stressNote">
                  “Largest → $0” stresses {portfolioStress.largestSymbol}. Real losses can be worse if liquidity disappears or prices gap.
                </p>
              </article>

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
                                navigateView('scanner')
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
              <p>Paste a public Solana wallet. RCXT reads public on-chain balances and activity only—no wallet connection or signing required.</p>
            </div>
          )}
        </section>
      )}

      <footer className="footer">
        <div>
          <b>RCXT RADAR · v6.1.0</b>
          <span>Score engine v6.1.0 · Solana + EVM · DexScreener · GeckoTerminal · RugCheck · GoPlus</span>
        </div>
        <p>
          Signals are software-generated market intelligence, not guarantees or personalized financial advice.
        </p>
      </footer>
    </main>
  )
}

function EmptyDrawer({ text }) {
  return <div className="emptyDrawer"><span>NO DATA YET</span><p>{text}</p></div>
}

function ServiceTile({ label, service }) {
  const ok = service?.ok !== false
  return (
    <div className={ok ? 'serviceTile' : 'serviceTile degraded'}>
      <div><span className="serviceDot" /><strong>{label}</strong></div>
      <b>{service ? (ok ? 'LIVE' : 'ISSUE') : 'CHECKING'}</b>
      <small>{service?.latencyMs != null ? `${service.latencyMs}ms` : '—'}</small>
    </div>
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


function ScanVerdict({ scan }) {
  const intel = scan?.intelligence || {}
  const { verdict, tone, reason, checks } = deriveScanVerdict(scan)

  return (
    <article className={`scanVerdict ${tone}`}>
      <div className="scanVerdictMain">
        <div className="scanVerdictIdentity">
          <span>{scan?.token?.symbol || 'TOKEN'} · {scan?.chain?.label || 'Unknown chain'}</span>
          <strong>{scan?.token?.name || 'Token scan'}</strong>
          <button className="addressButton" onClick={() => navigator.clipboard?.writeText(scan?.address || '')}>
            {shortAddress(scan?.address)} · copy
          </button>
        </div>
        <div className="scanVerdictAnswer">
          <small>RCXT SETUP RESULT</small>
          <b>{verdict}</b>
          <span>{verdict === 'YES' ? 'Setup passes current gates' : verdict === 'NO' ? 'Risk controls veto this setup' : 'Wait for more confirmation'}</span>
        </div>
        <div className="scanVerdictScore">
          <strong>{intel.score ?? '—'}<small>/100</small></strong>
          <span>{intel.confidence ?? '—'}% evidence confidence</span>
          <em>{intel.risk || 'UNKNOWN'} risk</em>
        </div>
      </div>
      <p className="scanVerdictReason">{reason}</p>
      <div className="scanVerdictChecks">
        {checks.map((check) => (
          <div key={check.label} className={check.state}>
            <span>{check.label}</span>
            <b>{check.value}</b>
          </div>
        ))}
      </div>
      <small className="scanVerdictNote">YES / WAIT / NO summarizes RCXT's current setup gates. It is not a guarantee of price direction or profit.</small>
    </article>
  )
}

function BeginnerSnapshot({ scan }) {
  const intel = scan?.intelligence || {}
  const positives = Array.isArray(intel.positives) ? intel.positives.slice(0, 3) : []
  const negatives = Array.isArray(intel.negatives) ? intel.negatives.slice(0, 3) : []
  const concentrationAvailable = Boolean(intel?.concentration?.available)
  const holderRpcMissing = scan?.security?.sources?.largestAccounts === false
  const mcPlan = intel?.marketCapPlan || null
  const headline = intel.opportunityLabel === 'HOT / HIGH RISK'
    ? 'Hot momentum, high risk'
    : {
        'BUY SETUP': 'Strong setup structure',
        'LEAN BUY': 'Constructive setup',
        WATCH: 'Wait for a cleaner setup',
        REDUCE: 'Setup is weakening',
        'SELL / AVOID': 'Structural danger detected',
      }[intel.signal] || 'Live setup read'
  const riskLabel = {
    LOWER: 'Lower relative risk',
    MODERATE: 'Moderate risk',
    HIGH: 'High risk',
    EXTREME: 'Extreme risk',
  }[intel.risk] || 'Risk unknown'

  const entryBlockers = intel.signal === 'WATCH'
    ? (Array.isArray(intel?.entryGate?.leanBuyMissing)
        ? intel.entryGate.leanBuyMissing
        : [])
    : (intel.signal === 'REDUCE' || intel.signal === 'SELL / AVOID')
      ? (negatives.length ? negatives : ['Current risk controls veto an entry'])
      : []

  const scoreCapReasons = Array.isArray(intel.scoreCaps)
    ? intel.scoreCaps.slice(0, 3).map((item) => String(item?.reason || '').replaceAll('_', ' ').toLowerCase())
    : []

  return (
    <article className="beginnerSnapshot">
      <div className="beginnerSnapshotHead">
        <div>
          <span>QUICK READ</span>
          <h3>{headline}</h3>
          <p>
            RCXT {intel.score ?? '—'}/100 measures tradability after risk caps. Opportunity {intel.opportunityScore ?? intel.setupScore ?? '—'}/100 tracks momentum, execution {intel.executionScore ?? '—'}/100 tracks how cleanly it can trade · {riskLabel}.
            Risk does not predict direction, and confidence is not the chance of profit.
          </p>
        </div>
        <div className="beginnerScore">
          <strong>{intel.score ?? '—'}</strong><span>/100</span>
          <small>{intel.signal || 'WATCH'}</small>
        </div>
      </div>
      <div className="beginnerDualRead three">
        <div>
          <span>OPPORTUNITY</span>
          <strong>{intel.opportunityScore ?? intel.setupScore ?? '—'}/100</strong>
          <small>{intel.opportunityLabel || 'Current setup'}</small>
        </div>
        <div>
          <span>EXECUTION</span>
          <strong>{intel.executionScore ?? '—'}/100</strong>
          <small>{intel.liquidityReported === false ? 'Liquidity depth partly unknown' : 'Liquidity + activity quality'}</small>
        </div>
        <div className={'riskTone ' + String(intel.risk || '').toLowerCase()}>
          <span>RISK</span>
          <strong>{intel.risk || 'UNKNOWN'}</strong>
          <small>{intel.directionalBias || 'NEUTRAL'} directional bias</small>
        </div>
      </div>

      {Number(intel.scoreBeforeCaps) > Number(intel.score) && scoreCapReasons.length ? (
        <div className="beginnerScoreExplain">
          <b>WHY {intel.score ?? '—'}/100</b>
          <span>Raw blend {intel.scoreBeforeCaps}/100 → capped by {scoreCapReasons.join(' · ')}.</span>
        </div>
      ) : null}

      {intel.opportunityLabel === 'HOT / HIGH RISK' ? (
        <div className="beginnerOpportunityNotice">
          <b>IMPORTANT</b>
          <span>RCXT sees real momentum, but execution/safety risk is still high. This token can keep running; the warning is about how fragile the trade is, not a prediction that price must fall.</span>
        </div>
      ) : null}

      <div className="beginnerTiles">
        <div><span>24H MOVE</span><strong className={Number(scan?.market?.priceChange?.h24 || 0) >= 0 ? 'positiveText' : 'negativeText'}>{percent(scan?.market?.priceChange?.h24)}</strong><small>Price direction</small></div>
        <div><span>BUY PRESSURE</span><strong>{intel.buyPercent24h ?? '—'}%</strong><small>24h transaction mix</small></div>
        <div>
          <span>LIQUIDITY</span>
          <strong>{intel.liquidityReported === false ? 'N/A' : compactUsd(scan?.market?.liquidityUsd)}</strong>
          <small>
            {intel.liquidityReported === false
              ? (intel.liquiditySource === 'PUMPFUN_BONDING_CURVE_UNREPORTED' ? 'Pump.fun bonding curve · AMM liquidity not reported' : 'Liquidity source unavailable')
              : `${intel.liquidityToCapPercent ?? '—'}% of market cap`}
          </small>
        </div>
        <div><span>PAIR AGE</span><strong>{intel.ageHours == null ? 'Unknown' : formatAge(intel.ageHours)}</strong><small>{intel.marketState || 'Live market'}</small></div>
      </div>

      {mcPlan?.available ? (
        <details className="quickPlanDisclosure">
          <summary>
            <div>
              <span>PLAN MAP</span>
              <strong>{mcPlan.action || 'Scenario zones'}</strong>
              <small>{compactUsd(mcPlan.current)} now · estimates, not guaranteed targets</small>
            </div>
            <b>OPEN</b>
          </summary>
          <div className="quickMcMap">
          <div className="quickMcMapHead">
            <div>
              <span>RCXT MC MAP</span>
              <strong>{mcPlan.action || 'Scenario zones'}</strong>
            </div>
            <small>estimates · not guaranteed targets</small>
          </div>
          <div className="quickMcMapGrid">
            <div><span>NOW</span><b>{compactUsd(mcPlan.current)}</b></div>
            <div className={mcPlan.entryLow == null ? 'disabled' : 'entry'}>
              <span>BUY / ENTRY</span>
              <b>{mcPlan.entryLow == null ? 'VETOED' : `${compactUsd(mcPlan.entryLow)}–${compactUsd(mcPlan.entryHigh)}`}</b>
            </div>
            <div className="positive"><span>TRIM / SELL</span><b>{mcPlan.trim1 == null ? '—' : compactUsd(mcPlan.trim1)}</b></div>
            <div className="negative"><span>INVALIDATION</span><b>{compactUsd(mcPlan.invalidation)}</b></div>
          </div>
          <small className="quickMcMapNote">
            Uses current market cap + recent volatility/risk. Advanced Data upgrades these zones with chart support/resistance when enough candles exist.
          </small>
        </div>
        </details>
      ) : null}
      {entryBlockers.length ? (
        <div className="beginnerBlocker">
          <b>{intel.signal === 'WATCH' ? 'WHY NOT A BUY YET' : 'WHY RCXT IS CAUTIOUS'}</b>
          <span>{entryBlockers.slice(0, 3).join(' · ')}</span>
        </div>
      ) : null}

      {intel.liquidityReported === false ? (
        <div className="beginnerDataNotice">
          <b>Liquidity data is incomplete</b>
          <span>
            {intel.liquiditySource === 'PUMPFUN_BONDING_CURVE_UNREPORTED'
              ? 'This is a Pump.fun bonding-curve market. DexScreener is not reporting AMM-style pool liquidity, so RCXT no longer treats the missing field as literal $0 liquidity.'
              : 'The current market source did not provide a usable liquidity value. RCXT treats it as unknown instead of assuming zero.'}
          </span>
        </div>
      ) : null}

      {!concentrationAvailable ? (
        <div className="beginnerDataNotice">
          <b>Holder data incomplete</b>
          <span>{holderRpcMissing
            ? 'Solana holder-concentration data was temporarily unavailable on this scan. RCXT does not assume it is safe and will retry automatically.'
            : 'Holder-concentration data is not available for this token yet. RCXT does not treat missing data as a safety confirmation.'}</span>
        </div>
      ) : null}
      <div className="beginnerReasons">
        <div>
          <span>GOOD SIGNS</span>
          {(positives.length ? positives : ['No strong positive confirmation yet']).map((item) => <p key={'good-' + item}><i className="dot good" />{item}</p>)}
        </div>
        <div>
          <span>WATCH OUT FOR</span>
          {(negatives.length ? negatives : ['No major warning in the current snapshot']).map((item) => <p key={'risk-' + item}><i className="dot bad" />{item}</p>)}
        </div>
      </div>
    </article>
  )
}

function CalibrationStrip({ calibration, modelVersion, signal, score }) {
  const rows = (calibration?.rows || []).filter(
    (row) => row.scoreVersion === modelVersion && row.signal === signal,
  )
  const samples = rows.reduce((sum, row) => sum + Number(row.samples || 0), 0)

  const bucketMin = Math.floor(Number(score || 0) / 10) * 10
  const bucketRows = (calibration?.buckets || []).filter(
    (row) => row.scoreVersion === modelVersion && Number(row.scoreBucketMin) === bucketMin && row.signal === signal,
  )
  const bucketSamples = bucketRows.reduce((sum, row) => sum + Number(row.samples || 0), 0)
  const componentRows = (calibration?.components || []).filter((row) => row.scoreVersion === modelVersion)
  const maxComponentSamples = componentRows.reduce(
    (max, row) => Math.max(max, Number(row.setupSamples || 0), Number(row.executionSamples || 0), Number(row.safetySamples || 0), Number(row.dataQualitySamples || 0)),
    0,
  )

  return (
    <div className={samples < 20 ? 'calibrationStrip collecting' : 'calibrationStrip'}>
      <div className="calibrationTitle">
        <div>
          <span>MODEL VALIDATION · {modelVersion}</span>
          <strong>{samples < 20 ? 'Collecting forward outcomes' : signal + ' calibration'}</strong>
        </div>
        <small>{calibration?.totalSamples || 0} total labeled outcomes</small>
      </div>

      <div className="calibrationRows">
        {samples < 20 ? (
          <div>
            <span>SIGNAL SAMPLE</span>
            <strong>{samples}/20</strong>
            <small>Minimum before directional statistics display</small>
          </div>
        ) : rows.map((row) => (
          <div key={'signal-' + row.horizon}>
            <span>{row.horizon}</span>
            <strong>{row.directionalHitRate == null ? '—' : Math.round(row.directionalHitRate * 100) + '% direction hit'}</strong>
            <small>
              avg {row.avgReturnPct == null ? '—' : (row.avgReturnPct >= 0 ? '+' : '') + fixed(row.avgReturnPct,1) + '%'}
              {' · '}{row.samples} samples
            </small>
          </div>
        ))}

        <div>
          <span>SCORE BUCKET {bucketMin}–{Math.min(100,bucketMin+9)}</span>
          <strong>{bucketSamples >= 30 ? bucketSamples + ' samples' : bucketSamples + '/30'}</strong>
          <small>{bucketSamples >= 30 ? 'Bucket-level forward outcomes available' : 'Collecting before bucket statistics are treated as meaningful'}</small>
        </div>

        <div>
          <span>COMPONENT VALIDATION</span>
          <strong>{maxComponentSamples >= 50 ? 'AVAILABLE' : maxComponentSamples + '/50'}</strong>
          <small>{maxComponentSamples >= 50 ? 'Setup / execution / safety correlations have enough samples to inspect' : 'Collecting before component correlations are interpreted'}</small>
        </div>
      </div>

      <small className="calibrationCaution">
        Historical forward outcomes validate model behavior; they do not guarantee future returns or turn the score into a probability of profit.
      </small>
    </div>
  )
}

function SnapshotDelta({ rows, current, modelVersion }) {
  const compatible = (rows || [])
    .filter((row) => row.scoreVersion === modelVersion)
    .sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))

  let previous = compatible[0] || null
  if (
    previous &&
    Number(previous.score) === Number(current?.score) &&
    Math.abs(Number(previous.priceUsd || 0) - Number(current?.priceUsd || 0)) <= Math.max(1e-12, Number(current?.priceUsd || 0) * 0.002)
  ) {
    previous = compatible[1] || null
  }

  if (!previous) {
    return (
      <div className="snapshotDelta empty">
        <span>SNAPSHOT DELTA</span>
        <small>Run another manual scan later to compare what changed.</small>
      </div>
    )
  }

  const deltaPct = (next, before) => {
    const a = Number(before || 0)
    const b = Number(next || 0)
    return a > 0 ? ((b / a) - 1) * 100 : null
  }

  const scoreDelta = Number(current?.score || 0) - Number(previous.score || 0)
  const ageMs = Date.now() - new Date(previous.createdAt || 0).getTime()
  const ageMinutes = Number.isFinite(ageMs) ? Math.max(0, ageMs / 60000) : null
  const items = [
    ['Score', scoreDelta, 'pts'],
    ...(previous.setupScore == null ? [] : [['Setup', Number(current?.setupScore || 0) - Number(previous.setupScore || 0), 'pts']]),
    ...(previous.executionScore == null ? [] : [['Execution', Number(current?.executionScore || 0) - Number(previous.executionScore || 0), 'pts']]),
    ...(previous.safetyScore == null ? [] : [['Safety', Number(current?.safetyScore || 0) - Number(previous.safetyScore || 0), 'pts']]),
    ...(previous.dataQualityScore == null ? [] : [['Data Quality', Number(current?.dataQualityScore || 0) - Number(previous.dataQualityScore || 0), 'pts']]),
    ['Price', deltaPct(current?.priceUsd, previous.priceUsd), '%'],
    ['Market Cap', deltaPct(current?.marketCap, previous.marketCap), '%'],
    ['Liquidity', deltaPct(current?.liquidityUsd, previous.liquidityUsd), '%'],
    ['24H Volume', deltaPct(current?.volume24h, previous.volume24h), '%'],
  ]

  const ageLabel = ageMinutes == null
    ? 'Prior saved scan'
    : ageMinutes < 60
      ? Math.round(ageMinutes) + 'm ago'
      : (ageMinutes / 60).toFixed(1) + 'h ago'

  return (
    <div className="snapshotDelta">
      <div className="snapshotDeltaHead">
        <div>
          <span>SNAPSHOT DELTA</span>
          <strong>{(previous.signal || 'PRIOR') + ' → ' + (current?.signal || 'CURRENT')}</strong>
        </div>
        <small>{ageLabel}</small>
      </div>
      <div className="snapshotDeltaGrid">
        {items.map(([label, raw, unit]) => {
          const value = raw == null || !Number.isFinite(raw) ? null : raw
          const tone = value == null ? '' : value > 0 ? 'positive' : value < 0 ? 'negative' : ''
          const rendered = value == null
            ? '—'
            : (value >= 0 ? '+' : '') + fixed(value,unit === 'pts' ? 0 : 1,'0') + unit
          return (
            <div key={label}>
              <span>{label}</span>
              <b className={tone}>{rendered}</b>
            </div>
          )
        })}
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
              <button key={assetKey(item,item?.chain||'solana')} onClick={() => onSelect(item)}>
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

function CompareTray({ items, onRemove, onOpen }) {
  return (
    <div className="compareTray">
      <div className="compareHead">
        <div><span>COMPARE MODE</span><small>{items.length}/4 tokens</small></div>
      </div>
      <div className="compareGrid">
        {items.map((item) => (
          <div className="compareCard" key={assetKey(item)}>
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

function number(value, digits = 2) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  })
}

function fixed(value, digits = 1, fallback = '—') {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(digits) : fallback
}

function usd(value) {
  return Number(value || 0).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

function compactUsd(value) {
  if (value === null || value === undefined || value === '') return '—'
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

function isPumpFunToken(scan) {
  const address = String(scan?.address || '')
  const dex = String(scan?.pair?.dex || '').toLowerCase()
  return address.endsWith('pump') || dex === 'pumpfun' || dex === 'pumpswap'
}

function formatAge(hours) {
  const n = Number(hours)
  if (!Number.isFinite(n) || n < 0) return 'Unknown'
  if (n < 1) return `${Math.round(n * 60)}m`
  if (n < 48) return `${fixed(n,1)}h`
  return `${fixed(n / 24,1)}d`
}
