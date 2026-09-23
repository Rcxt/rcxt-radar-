import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzePair, SCORE_VERSION } from '../lib/intelligence.js'

function healthyPair(){
  return {
    baseToken:{symbol:'TEST',name:'Test Token'},
    liquidity:{usd:100000},
    marketCap:1000000,
    fdv:1000000,
    volume:{m5:2500,h1:25000,h6:120000,h24:400000},
    priceChange:{m5:1,h1:4,h6:10,h24:18},
    txns:{
      m5:{buys:40,sells:30},
      h1:{buys:250,sells:180},
      h24:{buys:1500,sells:1200},
    },
    pairCreatedAt:Date.now()-48*60*60*1000,
  }
}

function baseSecurity(){
  return {
    available:true,
    mintAuthority:null,
    freezeAuthority:null,
    concentrationAvailable:true,
    top1Percent:15,
    top5Percent:35,
    top10Percent:55,
    ownerConcentrationAvailable:false,
    top1OwnerPercent:null,
    top5OwnerPercent:null,
    top10OwnerPercent:null,
    uniqueResolvedOwners:0,
  }
}

test('score engine version is 4.1.0',()=>{
  assert.equal(SCORE_VERSION,'4.1.0')
})

test('resolved owner concentration is preferred when available',()=>{
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    ownerConcentrationAvailable:true,
    top1OwnerPercent:80,
    top5OwnerPercent:90,
    top10OwnerPercent:96,
    uniqueResolvedOwners:4,
  })

  assert.equal(result.concentration.method,'RESOLVED_TOKEN_ACCOUNT_OWNERS')
  assert.equal(result.concentration.top1Percent,80)
  assert.equal(result.concentration.accountTop1Percent,15)
  assert.ok(result.riskFlags.includes('EXTREME_OWNER_CONCENTRATION'))
  assert.ok(!result.riskFlags.includes('EXTREME_ACCOUNT_CONCENTRATION'))
})

test('raw token-account concentration is used as fallback',()=>{
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    top1Percent:75,
    top5Percent:86,
    top10Percent:94,
  })

  assert.equal(result.concentration.method,'TOKEN_ACCOUNTS')
  assert.equal(result.concentration.top1Percent,75)
  assert.ok(result.riskFlags.includes('EXTREME_ACCOUNT_CONCENTRATION'))
  assert.ok(!result.riskFlags.includes('EXTREME_OWNER_CONCENTRATION'))
})

test('extreme concentration vetoes otherwise healthy setup',()=>{
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    ownerConcentrationAvailable:true,
    top1OwnerPercent:82,
    top5OwnerPercent:91,
    top10OwnerPercent:97,
    uniqueResolvedOwners:3,
  })

  assert.ok(result.score<=38)
  assert.equal(result.signal,'SELL / AVOID')
  assert.equal(result.risk,'EXTREME')
})
