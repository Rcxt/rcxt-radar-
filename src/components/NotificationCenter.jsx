import React from 'react'
import { NOTIFICATION_PRESETS, normalizeNotificationPrefs } from '../lib/notification-prefs.js'

const GROUPS=[
  {
    title:'Wallet buys',
    note:'These can run in the background when 24/7 Live Monitor is active.',
    items:[
      ['newBuy','Normal buy detected','One confirmation after RCXT detects a new token buy.'],
      ['rugRisk','Rug / contract danger','Critical authority or extreme concentration warning.'],
      ['highRiskBuy','High-risk buy','Your new buy scans as HIGH or EXTREME risk.'],
      ['hotMomentumBuy','Hot momentum + high risk','Strong momentum but fragile execution / safety.'],
    ],
  },
  {
    title:'Scanner',
    note:'These fire while the token scanner is active.',
    items:[
      ['signalChanges','Key signal changes','Only meaningful upgrades or danger downgrades by default.'],
      ['allSignalChanges','Every signal flip','Also alert on ordinary WATCH transitions.'],
      ['scoreCrossing','Score target','Alert when the RCXT score crosses your threshold.'],
      ['marketCapCrossing','Market-cap target','Alert when the scanned token crosses your MC target.'],
    ],
  },
  {
    title:'Radar + X',
    note:'Keep these off unless you want a busier feed.',
    items:[
      ['radarChanges','Radar signal changes','Alerts from tokens moving around the opportunity radar.'],
      ['xMomentum','X momentum spikes','Reserved for V5 X acceleration / narrative alerts.'],
      ['repeatBuyAlerts','Repeat wallet alerts','Bypass the same-token cooldown for separate wallet buys.'],
    ],
  },
]

function ToggleRow({checked,onChange,title,detail,disabled=false}){
  return (
    <label className={disabled?'notificationToggle disabled':'notificationToggle'}>
      <span className={checked?'notificationSwitch on':'notificationSwitch'}><i /></span>
      <input type="checkbox" checked={checked} onChange={(event)=>onChange(event.target.checked)} disabled={disabled} />
      <div><strong>{title}</strong><small>{detail}</small></div>
    </label>
  )
}

export default function NotificationCenter({
  prefs,
  onChange,
  liveMonitor,
  onToggleServerMonitor,
  scoreTarget,
  onScoreTarget,
  marketCapTarget,
  onMarketCapTarget,
}){
  const current=normalizeNotificationPrefs(prefs)
  const presetName=Object.entries(NOTIFICATION_PRESETS).find(([,preset])=>{
    const normalized=normalizeNotificationPrefs(preset)
    return Object.keys(normalized).every((key)=>normalized[key]===current[key])
  })?.[0] || 'CUSTOM'
  const enabledCount=[
    'newBuy','rugRisk','highRiskBuy','hotMomentumBuy','signalChanges',
    'scoreCrossing','marketCapCrossing','radarChanges','xMomentum','repeatBuyAlerts'
  ].filter((key)=>Boolean(current[key])).length

  function patch(next){
    onChange?.(normalizeNotificationPrefs({...current,...next}))
  }

  function applyPreset(name){
    patch(NOTIFICATION_PRESETS[name]||NOTIFICATION_PRESETS.KEY)
  }

  return (
    <div className="notificationCenter">
      <div className="notificationCenterHero">
        <div>
          <span>V5 ALERT CONTROL</span>
          <h4>Key alerts, not notification spam</h4>
          <p>RCXT groups repeat buys, replaces duplicate notifications, and keeps critical contract/rug warnings separate from ordinary market noise. {enabledCount} alert types are on.</p>
        </div>
        <button
          className={liveMonitor?.enabled?'monitorMiniToggle active':'monitorMiniToggle inactive'}
          onClick={()=>onToggleServerMonitor?.()}
          disabled={Boolean(liveMonitor?.loading)}
        >
          <i />
          {liveMonitor?.loading?'Checking…':liveMonitor?.enabled?'24/7 ACTIVE':'24/7 OFF'}
        </button>
      </div>

      <div className="notificationPresets">
        <button className={presetName==='KEY'?'active':''} onClick={()=>applyPreset('KEY')}>KEY ONLY<small>recommended</small></button>
        <button className={presetName==='ACTIVE'?'active':''} onClick={()=>applyPreset('ACTIVE')}>ACTIVE TRADER<small>more signals</small></button>
        <button className={presetName==='EVERYTHING'?'active':''} onClick={()=>applyPreset('EVERYTHING')}>ALL ALERTS<small>busy</small></button>
        <button className={presetName==='SILENT'?'active':''} onClick={()=>applyPreset('SILENT')}>SILENT<small>monitor only</small></button>
      </div>

      <div className="notificationSpamControl">
        <div>
          <span>ANTI-SPAM COOLDOWN</span>
          <strong>{current.cooldownMinutes} minutes</strong>
          <small>Same token + same alert class will not buzz again during this window unless Repeat buys is enabled.</small>
        </div>
        <select
          value={current.cooldownMinutes}
          onChange={(event)=>patch({cooldownMinutes:Number(event.target.value)})}
        >
          <option value="5">5 min</option>
          <option value="10">10 min</option>
          <option value="20">20 min</option>
          <option value="30">30 min</option>
          <option value="60">60 min</option>
          <option value="120">2 hr</option>
        </select>
      </div>

      <div className="notificationGroups">
        {GROUPS.map((group)=>(
          <section key={group.title}>
            <div className="notificationGroupHead">
              <strong>{group.title}</strong>
              <small>{group.note}</small>
            </div>
            {group.items.map(([key,title,detail])=>(
              <ToggleRow
                key={key}
                checked={Boolean(current[key])}
                disabled={key==='allSignalChanges'&&!current.signalChanges}
                onChange={(value)=>patch({[key]:value})}
                title={title}
                detail={detail}
              />
            ))}
          </section>
        ))}
      </div>

      <div className="notificationTargets">
        <label>
          <span>Score threshold</span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            max="100"
            value={scoreTarget}
            onChange={(event)=>onScoreTarget?.(Math.max(0,Math.min(100,Number(event.target.value||0))))}
          />
          <small>{current.scoreCrossing?'Enabled':'Turn on “Score target” above to use this.'}</small>
        </label>
        <label>
          <span>Market-cap threshold ($)</span>
          <input
            inputMode="decimal"
            placeholder="100000"
            value={marketCapTarget}
            onChange={(event)=>onMarketCapTarget?.(event.target.value)}
          />
          <small>{current.marketCapCrossing?'Enabled':'Turn on “Market-cap target” above to use this.'}</small>
        </label>
      </div>

      <div className="notificationLegend">
        <span><i className="critical" />Rug/contract danger can be marked critical.</span>
        <span><i className="normal" />Normal alerts replace matching notifications instead of stacking them.</span>
      </div>
    </div>
  )
}
