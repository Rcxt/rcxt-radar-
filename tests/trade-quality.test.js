import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeTradeQuality } from '../lib/trade-quality.js'

function trades({count=60,wallets=30,volume=20}={}){
  return Array.from({length:count},(_,index)=>({
    kind:index%2===0?'buy':'sell',
    volumeUsd:typeof volume==='function'?volume(index):volume,
    wallet:'wallet-'+(index%wallets),
  }))
}

test('broad trade participation stays low manipulation risk',()=>{
  const result=analyzeTradeQuality(trades({count:60,wallets:30,volume:25}))
  assert.equal(result.sampleQuality,'STRONG')
  assert.ok(result.manipulationRiskScore<25)
  assert.ok(!result.flags.includes('REPEAT_WALLET_CHURN'))
})

test('repeat-wallet churn is detected',()=>{
  const result=analyzeTradeQuality(trades({count:80,wallets:3,volume:15}))
  assert.ok(result.manipulationRiskScore>=45)
  assert.ok(result.flags.includes('LOW_WALLET_DIVERSITY'))
  assert.ok(result.flags.includes('REPEAT_WALLET_CHURN'))
  assert.ok(result.flags.includes('WALLET_ACTIVITY_CONCENTRATION'))
})

test('microtrade spam contributes to activity-quality risk',()=>{
  const result=analyzeTradeQuality(trades({count:60,wallets:10,volume:()=>0.25}))
  assert.ok(result.flags.includes('MICROTRADE_NOISE'))
  assert.ok(result.manipulationRiskScore>0)
})

test('one whale trade alone is caution evidence, not automatic wash verdict',()=>{
  const sample=trades({count:40,wallets:25,volume:20})
  sample[0].volumeUsd=5000
  const result=analyzeTradeQuality(sample)
  assert.ok(result.flags.includes('TOP_TRADE_CONCENTRATED'))
  assert.ok(result.manipulationRiskScore<45)
})
