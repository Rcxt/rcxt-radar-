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

test('score engine version is 6.1.0',()=>{
  assert.equal(SCORE_VERSION,'6.1.0')
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
  assert.ok(result.riskFlags.includes('RAW_ACCOUNT_CONCENTRATION_UNVERIFIED'))
  assert.ok(!result.riskFlags.includes('EXTREME_OWNER_CONCENTRATION'))
  assert.notEqual(result.signal,'SELL / AVOID')
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


test('permanent delegate is structural danger for meme-token execution',()=>{
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    token2022:true,
    permanentDelegate:'11111111111111111111111111111111',
    external:{providerCount:0,dataConflicts:[],hardRiskFlags:[],softRiskFlags:[]},
  })

  assert.ok(result.riskFlags.includes('PERMANENT_DELEGATE_ACTIVE'))
  assert.ok(result.score<=30)
  assert.equal(result.signal,'SELL / AVOID')
  assert.equal(result.contractVerified,false)
})

test('Token-2022 transfer fee reduces execution without being called a rug',()=>{
  const baseline=analyzePair(healthyPair(),baseSecurity())
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    token2022:true,
    transferFeeEnabled:true,
    transferFeeBasisPoints:750,
  })

  assert.ok(result.executionScore<baseline.executionScore)
  assert.ok(result.riskFlags.includes('TOKEN2022_TRANSFER_FEE'))
  assert.equal(result.securityEvidence.token2022.transferFeeBasisPoints,750)
  assert.ok(!result.riskFlags.includes('EXTERNAL_RUGGED'))
})

test('non-transferable Token-2022 mint is a hard execution veto',()=>{
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    token2022:true,
    nonTransferable:true,
  })

  assert.ok(result.score<=8)
  assert.ok(result.riskFlags.includes('NON_TRANSFERABLE_TOKEN'))
  assert.equal(result.signal,'SELL / AVOID')
})

test('transfer hook is caution evidence and caps aggressive promotion',()=>{
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    token2022:true,
    transferHookProgramId:'Vote111111111111111111111111111111111111111',
  })

  assert.ok(result.riskFlags.includes('TRANSFER_HOOK_ACTIVE'))
  assert.ok(result.score<=60)
  assert.notEqual(result.signal,'BUY SETUP')
})


function evmSecurity(overrides={}){
  return {
    available:true,
    securityModel:'evm-token',
    source:'evm-rpc',
    contractCodePresent:true,
    concentrationAvailable:false,
    ownerConcentrationAvailable:false,
    externalConcentrationAvailable:true,
    externalConcentrationSource:'GOPLUS_TOP_HOLDERS',
    externalTop1Percent:12,
    externalTop5Percent:30,
    externalTop10Percent:48,
    external:{
      providerCount:2,
      providers:['evm-rpc','goplus'],
      dangerRiskCount:0,
      warningRiskCount:0,
      hardRiskFlags:[],
      softRiskFlags:[],
      dataConflicts:[],
      rugged:false,
      evidenceScore:72,
      authority:{corroboratedSafe:false,mint:{votes:[]},freeze:{votes:[]}},
      goplus:{
        available:true,
        model:'evm',
        openSource:true,
        honeypot:false,
        cannotSellAll:false,
        malicious:false,
        hiddenOwner:false,
        ownerChangeBalance:false,
        selfDestruct:false,
        transferPausable:false,
        blacklistActive:false,
        proxy:false,
        buyTaxPercent:2,
        sellTaxPercent:3,
        top1Percent:12,
        top10Percent:48,
      },
      market:{
        priceProviderCount:2,
        externalPriceProviderCount:1,
        maxDeviationPercent:2,
        priceConflict:false,
        priceAgreement:false,
        evidenceScore:54,
      },
    },
    ...overrides,
  }
}

test('healthy EVM evidence can verify contract without Solana authority claims',()=>{
  const result=analyzePair(healthyPair(),evmSecurity())

  assert.equal(result.contractVerified,true)
  assert.equal(result.securityEvidence.securityModel,'evm-token')
  assert.equal(result.securityEvidence.evm.openSource,true)
  assert.ok(!result.positives.some(value=>/mint authority/i.test(value)))
  assert.ok(!result.positives.some(value=>/freeze authority/i.test(value)))
})

test('EVM honeypot evidence hard-vetoes an otherwise healthy setup',()=>{
  const security=evmSecurity()
  security.external.hardRiskFlags=['GOPLUS_HONEYPOT']
  security.external.dangerRiskCount=1
  security.external.goplus.honeypot=true

  const result=analyzePair(healthyPair(),security)
  assert.equal(result.contractVerified,false)
  assert.equal(result.signal,'SELL / AVOID')
  assert.ok(result.score<=37)
})

test('closed-source EVM contract cannot be marked verified',()=>{
  const security=evmSecurity()
  security.external.goplus.openSource=false
  security.external.softRiskFlags=['GOPLUS_CLOSED_SOURCE']

  const result=analyzePair(healthyPair(),security)
  assert.equal(result.contractVerified,false)
  assert.ok(result.riskFlags.includes('EVM_CLOSED_SOURCE'))
})

test('extreme EVM token taxes cap score and execution quality',()=>{
  const security=evmSecurity()
  security.external.goplus.buyTaxPercent=55
  security.external.goplus.sellTaxPercent=60

  const result=analyzePair(healthyPair(),security)
  assert.ok(result.riskFlags.includes('EVM_EXTREME_TAX'))
  assert.ok(result.score<=35)
  assert.ok(result.executionScore<60)
})


test('stable-looking symbol cannot bypass normal contract scoring',()=>{
  const pair=healthyPair()
  pair.baseToken={symbol:'USDC',name:'USD Coin'}
  const result=analyzePair(pair,baseSecurity())

  assert.notEqual(result.marketState,'STABLE ASSET')
  assert.ok(!result.riskFlags.includes('STABLE_ASSET'))
  assert.notEqual(result.grade,'N/A')
})

test('FDV-only token does not receive mislabeled market-cap targets',()=>{
  const pair=healthyPair()
  pair.marketCap=null
  pair.fdv=2_000_000
  const result=analyzePair(pair,baseSecurity())

  assert.equal(result.valuationBasis,'FDV')
  assert.equal(result.marketCapPlan.available,false)
  assert.equal(result.marketCapPlan.basis,'fdv-only')
  assert.equal(result.marketCapPlan.fdv,2_000_000)
})

test('external holder evidence is preferred over unresolved raw token accounts',()=>{
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    top1Percent:80,
    top5Percent:90,
    top10Percent:97,
    ownerConcentrationAvailable:false,
    externalConcentrationAvailable:true,
    externalConcentrationSource:'RUGCHECK_TOP_HOLDERS',
    externalTop1Percent:12,
    externalTop5Percent:31,
    externalTop10Percent:54,
    external:{
      providerCount:2,
      providers:['solana-rpc','rugcheck'],
      dangerRiskCount:0,
      warningRiskCount:0,
      hardRiskFlags:[],
      softRiskFlags:[],
      dataConflicts:[],
      rugged:false,
      evidenceScore:80,
      market:{priceProviderCount:2,externalPriceProviderCount:1,priceConflict:false,liquidityConflict:false},
    },
  })

  assert.equal(result.concentration.method,'RUGCHECK_TOP_HOLDERS')
  assert.equal(result.concentration.top1Percent,12)
  assert.ok(!result.riskFlags.includes('RAW_ACCOUNT_CONCENTRATION_UNVERIFIED'))
})

test('security without independent corroboration cannot promote to LEAN BUY',()=>{
  const result=analyzePair(healthyPair(),{
    ...baseSecurity(),
    external:{
      providerCount:1,
      providers:['solana-rpc'],
      dangerRiskCount:0,
      warningRiskCount:0,
      hardRiskFlags:[],
      softRiskFlags:[],
      dataConflicts:[],
      rugged:false,
      market:{priceProviderCount:2,externalPriceProviderCount:1,priceConflict:false,liquidityConflict:false},
    },
  })

  assert.equal(result.signal,'WATCH')
  assert.ok(result.entryGate.leanBuyMissing.some(item=>/Security evidence/i.test(item)))
  assert.ok(result.score<=74)
})

test('single live price source cannot promote to LEAN BUY',()=>{
  const security=evmSecurity()
  security.external.market.priceProviderCount=1
  security.external.market.externalPriceProviderCount=0
  const result=analyzePair(healthyPair(),security)

  assert.equal(result.signal,'WATCH')
  assert.ok(result.entryGate.leanBuyMissing.some(item=>/price is not corroborated/i.test(item)))
  assert.ok(result.score<=74)
})

test('liquidity-source conflict blocks entry promotion and lowers confidence',()=>{
  const security=evmSecurity()
  security.external.market.liquidityConflict=true
  const result=analyzePair(healthyPair(),security)

  assert.equal(result.signal,'WATCH')
  assert.ok(result.riskFlags.includes('LIQUIDITY_SOURCE_CONFLICT'))
  assert.ok(result.confidence<=68)
  assert.ok(result.score<=72)
})

test('market-cap conflict suppresses scenario targets',()=>{
  const security=evmSecurity()
  security.external.market.marketCapConflict=true
  security.external.market.marketCapProviderCount=2
  security.external.market.marketCapSpreadPercent=60
  const result=analyzePair(healthyPair(),security)

  assert.equal(result.marketCapPlan.available,false)
  assert.equal(result.marketCapPlan.basis,'market-cap-source-conflict')
  assert.ok(result.riskFlags.includes('MARKET_CAP_SOURCE_CONFLICT'))
  assert.ok(result.confidence<=70)
})

test('EVM mintability prevents full contract verification and buy promotion',()=>{
  const security=evmSecurity()
  security.external.goplus.mintable=true
  security.external.softRiskFlags=['GOPLUS_MINTABLE']
  const result=analyzePair(healthyPair(),security)

  assert.equal(result.contractVerified,false)
  assert.ok(result.riskFlags.includes('EVM_MINTABLE'))
  assert.equal(result.signal,'WATCH')
})

test('EVM reclaimable ownership prevents full contract verification',()=>{
  const security=evmSecurity()
  security.external.goplus.takeBackOwnership=true
  security.external.softRiskFlags=['GOPLUS_OWNERSHIP_RECLAIMABLE']
  const result=analyzePair(healthyPair(),security)

  assert.equal(result.contractVerified,false)
  assert.ok(result.riskFlags.includes('EVM_OWNERSHIP_RECLAIMABLE'))
  assert.equal(result.signal,'WATCH')
})

test('cannot-sell-all is restrictive but not treated like a honeypot',()=>{
  const security=evmSecurity()
  security.external.goplus.cannotSellAll=true
  security.external.softRiskFlags=['GOPLUS_CANNOT_SELL_ALL']
  const result=analyzePair(healthyPair(),security)

  assert.ok(result.riskFlags.includes('EVM_CANNOT_SELL_ALL'))
  assert.ok(!result.riskFlags.includes('EXTERNAL_STRUCTURAL_DANGER'))
  assert.notEqual(result.signal,'SELL / AVOID')
  assert.equal(result.contractVerified,false)
})


test('missing 5m price change does not earn flat-momentum bonus',()=>{
  const complete=healthyPair()
  complete.priceChange.m5=0
  const missing=healthyPair()
  delete missing.priceChange.m5

  const completeResult=analyzePair(complete,baseSecurity())
  const missingResult=analyzePair(missing,baseSecurity())

  assert.ok(completeResult.setupScore>=missingResult.setupScore)
  assert.equal(missingResult.microAcceleration,completeResult.microAcceleration)
})

test('missing flow cannot masquerade as neutral 50-50 entry confirmation',()=>{
  const pair=healthyPair()
  delete pair.txns.h1
  const result=analyzePair(pair,baseSecurity())

  assert.equal(result.signal,'WATCH')
  assert.ok(result.entryGate.leanBuyMissing.some(item=>/1h transaction flow/i.test(item)))
})

test('unknown pair age blocks entry promotion',()=>{
  const pair=healthyPair()
  delete pair.pairCreatedAt
  const result=analyzePair(pair,baseSecurity())

  assert.equal(result.signal,'WATCH')
  assert.ok(result.entryGate.leanBuyMissing.some(item=>/Pair age is unavailable/i.test(item)))
  assert.equal(result.marketCapPlan.available,false)
  assert.equal(result.marketCapPlan.basis,'insufficient-market-history')
})

test('missing momentum fields remain unknown and suppress target scenarios',()=>{
  const pair=healthyPair()
  delete pair.priceChange.h1
  delete pair.priceChange.h6
  const result=analyzePair(pair,baseSecurity())

  assert.equal(result.signal,'WATCH')
  assert.ok(result.entryGate.leanBuyMissing.some(item=>/1h momentum data is unavailable/i.test(item)))
  assert.ok(result.entryGate.leanBuyMissing.some(item=>/6h momentum data is unavailable/i.test(item)))
  assert.equal(result.marketCapPlan.available,false)
})


test('high manipulation-risk trade tape blocks entry promotion',()=>{
  const security=evmSecurity()
  security.external.market.tradeQuality={
    available:true,
    sampleQuality:'STRONG',
    manipulationRiskScore:82,
    activityQualityScore:18,
    flags:['LOW_WALLET_DIVERSITY','REPEAT_WALLET_CHURN','WALLET_ACTIVITY_CONCENTRATION'],
    summary:{sampleSize:60,uniqueWallets:3},
  }
  const result=analyzePair(healthyPair(),security)

  assert.equal(result.signal,'WATCH')
  assert.ok(result.riskFlags.includes('ACTIVITY_QUALITY_HIGH_RISK'))
  assert.ok(result.score<=58)
  assert.ok(result.confidence<=55)
  assert.ok(result.entryGate.leanBuyMissing.some(item=>/trade activity/i.test(item)))
})

test('clean trade sample never boosts setup or safety score',()=>{
  const baselineSecurity=evmSecurity()
  const baseline=analyzePair(healthyPair(),baselineSecurity)

  const cleanSecurity=evmSecurity()
  cleanSecurity.external.market.tradeQuality={
    available:true,
    sampleQuality:'STRONG',
    manipulationRiskScore:0,
    activityQualityScore:100,
    flags:[],
    summary:{sampleSize:60,uniqueWallets:30},
  }
  const clean=analyzePair(healthyPair(),cleanSecurity)

  assert.equal(clean.setupScore,baseline.setupScore)
  assert.equal(clean.safetyScore,baseline.safetyScore)
  assert.ok(clean.dataQualityScore>=baseline.dataQualityScore)
})
