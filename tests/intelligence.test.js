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

test('score engine version is 6.0.0-rc.1',()=>{
  assert.equal(SCORE_VERSION,'6.0.0-rc.1')
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


test('newborn thin-liquidity momentum is high risk without becoming a bearish sell signal',()=>{
  const pair={
    baseToken:{symbol:'SOMO',name:'StreamFomo'},
    liquidity:{usd:0},
    marketCap:5000,
    fdv:5000,
    volume:{m5:2200,h1:9500,h6:11000,h24:12000},
    priceChange:{m5:18,h1:42,h6:180,h24:350},
    txns:{
      m5:{buys:42,sells:20},
      h1:{buys:170,sells:92},
      h24:{buys:180,sells:96},
    },
    pairCreatedAt:Date.now()-10*60*1000,
  }

  const result=analyzePair(pair,{
    ...baseSecurity(),
    concentrationAvailable:false,
    top1Percent:null,
    top5Percent:null,
    top10Percent:null,
  })

  assert.equal(result.risk,'EXTREME')
  assert.equal(result.signal,'WATCH')
  assert.notEqual(result.directionalBias,'BEARISH')
  assert.ok(result.opportunityScore>=50)
  assert.ok(result.riskFlags.includes('VERY_NEW_PAIR'))
  assert.ok(result.riskFlags.includes('LOW_LIQUIDITY'))
  assert.ok(result.riskFlags.includes('PARABOLIC_MOVE'))
})

test('hard contract danger still vetoes momentum',()=>{
  const pair=healthyPair()
  pair.priceChange={m5:6,h1:15,h6:35,h24:80}
  const result=analyzePair(pair,{
    ...baseSecurity(),
    mintAuthority:'active-authority',
  })

  assert.equal(result.signal,'SELL / AVOID')
  assert.ok(result.riskFlags.includes('MINT_AUTHORITY_ACTIVE'))
})


test('pumpfun missing AMM liquidity is treated as unknown instead of zero liquidity',()=>{
  const pair=healthyPair()
  pair.dexId='pumpfun'
  pair.liquidity={}
  pair.pairCreatedAt=Date.now()-10*60*1000

  const result=analyzePair(pair,baseSecurity())

  assert.equal(result.liquidityReported,false)
  assert.equal(result.liquiditySource,'PUMPFUN_BONDING_CURVE_UNREPORTED')
  assert.ok(result.riskFlags.includes('LIQUIDITY_DATA_UNAVAILABLE'))
  assert.ok(!result.riskFlags.includes('LOW_LIQUIDITY'))
  assert.ok(!result.riskFlags.includes('LOW_LIQUIDITY_RATIO'))
  assert.notEqual(result.signal,'SELL / AVOID')
})


test('market-cap map produces deterministic scenario zones from live pair inputs',()=>{
  const result=analyzePair(healthyPair(),baseSecurity())
  const plan=result.marketCapPlan

  assert.equal(plan.available,true)
  assert.equal(plan.current,1000000)
  assert.ok(plan.entryLow>0)
  assert.ok(plan.entryHigh>=plan.entryLow)
  assert.ok(plan.breakout>plan.current)
  assert.ok(plan.trim1>=plan.breakout)
  assert.ok(plan.target2>=plan.trim1)
  assert.ok(plan.stretch>=plan.target2)
  assert.ok(plan.invalidation<plan.current)
  assert.match(plan.basis,/volatility/i)
})

test('hard structural danger vetoes entry market-cap estimates',()=>{
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    freezeAuthority:'active-freeze-authority',
  })

  assert.equal(result.signal,'SELL / AVOID')
  assert.equal(result.marketCapPlan.available,true)
  assert.equal(result.marketCapPlan.entryLow,null)
  assert.equal(result.marketCapPlan.entryHigh,null)
  assert.match(result.marketCapPlan.action,/NO ENTRY/)
})


test('v5 exposes score provenance and entry-gate blockers',()=>{
  const pair=healthyPair()
  pair.priceChange={m5:2,h1:1,h6:4,h24:170}
  const result=analyzePair(pair,baseSecurity())

  assert.ok(Number.isFinite(result.scoreBeforeCaps))
  assert.ok(Array.isArray(result.scoreCaps))
  assert.ok(result.entryGate)
  assert.ok(Array.isArray(result.entryGate.leanBuyMissing))
  assert.ok(result.entryGate.leanBuyMissing.some((item)=>item.includes('150%')))
  assert.equal(result.entryGate.buySetupEligible,false)
})

test('informational risk flags do not become extreme risk by count alone',()=>{
  const pair=healthyPair()
  pair.dexId='pumpfun'
  pair.liquidity={}
  pair.pairCreatedAt=Date.now()-40*60*1000
  pair.priceChange={m5:8,h1:22,h6:70,h24:160}
  pair.volume={m5:8000,h1:50000,h6:140000,h24:260000}
  pair.txns={
    m5:{buys:70,sells:40},
    h1:{buys:310,sells:180},
    h24:{buys:1100,sells:780},
  }

  const result=analyzePair(pair,{
    ...baseSecurity(),
    concentrationAvailable:false,
    top1Percent:null,
    top5Percent:null,
    top10Percent:null,
  })

  assert.ok(result.riskFlags.includes('LIQUIDITY_DATA_UNAVAILABLE'))
  assert.notEqual(result.risk,'EXTREME')
  assert.notEqual(result.signal,'SELL / AVOID')
})

test('v5 confidence is capped when critical market fields are missing',()=>{
  const pair=healthyPair()
  pair.dexId='pumpfun'
  pair.liquidity={}
  const result=analyzePair(pair,{
    available:false,
    concentrationAvailable:false,
  })

  assert.ok(result.confidence<=72)
  assert.equal(result.liquidityReported,false)
})


test('recorded StreamFomo regression keeps Pump.fun zero-liquidity field from forcing SELL / AVOID',()=>{
  const pair={
    dexId:'pumpfun',
    baseToken:{symbol:'SOMO',name:'StreamFomo'},
    liquidity:{usd:0},
    marketCap:4675.78,
    fdv:4675.78,
    volume:{m5:2200,h1:9500,h6:11000,h24:10361.77},
    priceChange:{m5:18,h1:42,h6:180,h24:350},
    txns:{
      m5:{buys:42,sells:20},
      h1:{buys:170,sells:92},
      h24:{buys:180,sells:96},
    },
    pairCreatedAt:Date.now()-10*60*1000,
  }

  const result=analyzePair(pair,{
    ...baseSecurity(),
    concentrationAvailable:false,
    top1Percent:null,
    top5Percent:null,
    top10Percent:null,
  })

  assert.equal(result.liquidityReported,false)
  assert.equal(result.liquiditySource,'PUMPFUN_BONDING_CURVE_UNREPORTED')
  assert.ok(result.riskFlags.includes('LIQUIDITY_DATA_UNAVAILABLE'))
  assert.ok(result.riskFlags.includes('PARABOLIC_MOVE'))
  assert.ok(result.riskFlags.includes('VERY_NEW_PAIR'))
  assert.ok(!result.riskFlags.includes('LOW_LIQUIDITY'))
  assert.ok(!result.riskFlags.includes('LOW_LIQUIDITY_RATIO'))
  assert.equal(result.signal,'WATCH')
  assert.equal(result.risk,'HIGH')
  assert.notEqual(result.directionalBias,'BEARISH')
})


test('WATCH exposes the final score gate when structure passes but risk-adjusted score is below 69',()=>{
  const pair=healthyPair()
  pair.liquidity={usd:12000}
  pair.priceChange={m5:1,h1:3,h6:8,h24:16}
  pair.txns={
    m5:{buys:20,sells:15},
    h1:{buys:90,sells:70},
    h24:{buys:500,sells:430},
  }

  const result=analyzePair(pair,{
    ...baseSecurity(),
    concentrationAvailable:true,
    top1Percent:44,
    top5Percent:70,
    top10Percent:88,
  })

  if(result.signal==='WATCH'&&result.score<69){
    assert.ok(result.entryGate.leanBuyMissing.some((item)=>item.includes('below 69')))
  }else{
    assert.ok(['WATCH','LEAN BUY','BUY SETUP'].includes(result.signal))
  }
})


test('rugged external evidence vetoes an otherwise healthy setup',()=>{
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    external:{
      providerCount:1,
      dangerRiskCount:1,
      hardRiskFlags:['RUGCHECK_RUGGED'],
      dataConflicts:[],
      rugged:true,
      evidenceScore:20,
    },
  })

  assert.ok(result.score<=12)
  assert.equal(result.signal,'SELL / AVOID')
  assert.equal(result.risk,'EXTREME')
  assert.ok(result.riskFlags.includes('EXTERNAL_RUGGED'))
  assert.equal(result.securityEvidence.rugged,true)
})

test('authority disagreement lowers confidence and prevents contract verification',()=>{
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    external:{
      providerCount:2,
      dangerRiskCount:0,
      hardRiskFlags:[],
      dataConflicts:['MINT_AUTHORITY_CONFLICT'],
      rugged:false,
      evidenceScore:50,
      authority:{corroboratedSafe:false},
    },
  })

  assert.equal(result.contractVerified,false)
  assert.ok(result.confidence<=58)
  assert.ok(result.riskFlags.includes('SECURITY_DATA_CONFLICT'))
  assert.ok(result.score<=55)
  assert.deepEqual(result.securityEvidence.conflicts,['MINT_AUTHORITY_CONFLICT'])
})

test('external holder concentration is used only when onchain concentration is unavailable',()=>{
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    concentrationAvailable:false,
    ownerConcentrationAvailable:false,
    top1Percent:null,
    top5Percent:null,
    top10Percent:null,
    externalConcentrationAvailable:true,
    externalConcentrationSource:'RUGCHECK_TOP_HOLDERS',
    externalTop1Percent:18,
    externalTop5Percent:37,
    externalTop10Percent:59,
    external:{
      providerCount:1,
      dangerRiskCount:0,
      hardRiskFlags:[],
      dataConflicts:[],
      rugged:false,
      evidenceScore:62,
    },
  })

  assert.equal(result.concentration.available,true)
  assert.equal(result.concentration.method,'RUGCHECK_TOP_HOLDERS')
  assert.equal(result.concentration.top1Percent,18)
  assert.equal(result.concentration.top10Percent,59)
})

test('very low Jupiter organic activity trims setup and execution without a hard structural veto',()=>{
  const baseline=analyzePair(healthyPair(),{
    ...baseSecurity(),
    external:{
      providerCount:1,
      dangerRiskCount:0,
      hardRiskFlags:[],
      dataConflicts:[],
      rugged:false,
      evidenceScore:65,
      jupiterOrganicScore:80,
    },
  })
  const lowOrganic=analyzePair(healthyPair(),{
    ...baseSecurity(),
    external:{
      providerCount:1,
      dangerRiskCount:0,
      hardRiskFlags:[],
      dataConflicts:[],
      rugged:false,
      evidenceScore:65,
      jupiterOrganicScore:8,
    },
  })

  assert.ok(lowOrganic.setupScore<baseline.setupScore)
  assert.ok(lowOrganic.executionScore<baseline.executionScore)
  assert.ok(lowOrganic.riskFlags.includes('LOW_ORGANIC_ACTIVITY'))
  assert.notEqual(lowOrganic.signal,'SELL / AVOID')
})


test('market price conflict blocks buy promotion and caps confidence',()=>{
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    external:{
      providerCount:3,
      dangerRiskCount:0,
      warningRiskCount:0,
      hardRiskFlags:[],
      softRiskFlags:[],
      dataConflicts:[],
      rugged:false,
      evidenceScore:88,
      authority:{corroboratedSafe:true},
      market:{
        priceProviderCount:3,
        externalPriceProviderCount:2,
        medianPriceUsd:0.001,
        maxDeviationPercent:18,
        priceConflict:true,
        priceAgreement:false,
        evidenceScore:50,
      },
    },
  })

  assert.ok(result.score<=68)
  assert.ok(result.confidence<=55)
  assert.ok(result.riskFlags.includes('PRICE_SOURCE_CONFLICT'))
  assert.equal(result.securityEvidence.market.priceConflict,true)
  assert.notEqual(result.signal,'BUY SETUP')
})

test('three-source price agreement improves data quality without changing safety facts',()=>{
  const baseline=analyzePair(healthyPair(),{
    ...baseSecurity(),
    external:{
      providerCount:2,
      dangerRiskCount:0,
      warningRiskCount:0,
      hardRiskFlags:[],
      softRiskFlags:[],
      dataConflicts:[],
      rugged:false,
      evidenceScore:80,
      authority:{corroboratedSafe:true},
    },
  })
  const corroborated=analyzePair(healthyPair(),{
    ...baseSecurity(),
    external:{
      providerCount:3,
      dangerRiskCount:0,
      warningRiskCount:0,
      hardRiskFlags:[],
      softRiskFlags:[],
      dataConflicts:[],
      rugged:false,
      evidenceScore:92,
      authority:{corroboratedSafe:true},
      market:{
        priceProviderCount:4,
        externalPriceProviderCount:3,
        medianPriceUsd:0.001,
        maxDeviationPercent:2.5,
        priceConflict:false,
        priceAgreement:true,
        evidenceScore:94,
      },
    },
  })

  assert.ok(corroborated.dataQualityScore>=baseline.dataQualityScore)
  assert.equal(corroborated.securityEvidence.market.priceAgreement,true)
})

test('Jupiter suspicious flag is cautionary but not mislabeled as a rug',()=>{
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    external:{
      providerCount:3,
      dangerRiskCount:0,
      warningRiskCount:1,
      hardRiskFlags:['JUPITER_SUSPICIOUS'],
      softRiskFlags:[],
      dataConflicts:[],
      rugged:false,
      evidenceScore:70,
      jupiterSuspicious:true,
      authority:{corroboratedSafe:true},
    },
  })

  assert.ok(result.riskFlags.includes('JUPITER_SUSPICIOUS'))
  assert.equal(result.securityEvidence.rugged,false)
  assert.ok(result.score<=52)
})

test('transfer-fee evidence reduces execution quality',()=>{
  const baseline=analyzePair(healthyPair(),{
    ...baseSecurity(),
    external:{
      providerCount:2,
      dangerRiskCount:0,
      warningRiskCount:0,
      hardRiskFlags:[],
      softRiskFlags:[],
      dataConflicts:[],
      rugged:false,
      evidenceScore:80,
    },
  })
  const taxed=analyzePair(healthyPair(),{
    ...baseSecurity(),
    external:{
      providerCount:3,
      dangerRiskCount:0,
      warningRiskCount:1,
      hardRiskFlags:[],
      softRiskFlags:['BIRDEYE_TRANSFER_FEE'],
      dataConflicts:[],
      rugged:false,
      evidenceScore:80,
    },
  })

  assert.ok(taxed.executionScore<baseline.executionScore)
  assert.ok(taxed.riskFlags.includes('TRANSFER_FEE_ENABLED'))
})
