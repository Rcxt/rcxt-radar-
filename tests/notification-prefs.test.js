import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_PRESETS,
  classifySignalTransition,
  normalizeNotificationPrefs,
  shouldNotifySignalTransition,
} from '../src/lib/notification-prefs.js'

test('notification defaults are intentionally quiet',()=>{
  assert.equal(DEFAULT_NOTIFICATION_PREFS.newBuy,true)
  assert.equal(DEFAULT_NOTIFICATION_PREFS.rugRisk,true)
  assert.equal(DEFAULT_NOTIFICATION_PREFS.highRiskBuy,true)
  assert.equal(DEFAULT_NOTIFICATION_PREFS.hotMomentumBuy,false)
  assert.equal(DEFAULT_NOTIFICATION_PREFS.radarChanges,false)
  assert.equal(DEFAULT_NOTIFICATION_PREFS.scoreCrossing,false)
  assert.equal(DEFAULT_NOTIFICATION_PREFS.repeatBuyAlerts,false)
  assert.equal(DEFAULT_NOTIFICATION_PREFS.cooldownMinutes,20)
})

test('notification preferences sanitize values and clamp cooldown',()=>{
  const prefs=normalizeNotificationPrefs({
    newBuy:false,
    rugRisk:'yes',
    allSignalChanges:true,
    signalChanges:false,
    cooldownMinutes:999,
  })
  assert.equal(prefs.newBuy,false)
  assert.equal(prefs.rugRisk,true)
  assert.equal(prefs.signalChanges,false)
  assert.equal(prefs.allSignalChanges,false)
  assert.equal(prefs.cooldownMinutes,180)
})

test('key signal mode only alerts on meaningful upgrades or danger',()=>{
  const prefs=NOTIFICATION_PRESETS.KEY
  assert.equal(classifySignalTransition('WATCH','LEAN BUY'),'upgrade')
  assert.equal(classifySignalTransition('LEAN BUY','WATCH'),'other')
  assert.equal(classifySignalTransition('WATCH','SELL / AVOID'),'danger')
  assert.equal(shouldNotifySignalTransition('WATCH','LEAN BUY',prefs),true)
  assert.equal(shouldNotifySignalTransition('LEAN BUY','WATCH',prefs),false)
  assert.equal(shouldNotifySignalTransition('WATCH','SELL / AVOID',prefs),true)
})

test('everything preset allows every signal flip',()=>{
  const prefs=NOTIFICATION_PRESETS.EVERYTHING
  assert.equal(shouldNotifySignalTransition('LEAN BUY','WATCH',prefs),true)
  assert.equal(shouldNotifySignalTransition('WATCH','REDUCE',prefs),true)
})
