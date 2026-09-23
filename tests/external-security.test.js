import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeSecurityEvidence,
  normalizeBirdeyeSecurity,
  normalizeGoPlusSolana,
  normalizeJupiterToken,
  normalizeRugcheckReport,
} from '../lib/external-security.js'

function onchainSafe(){
  return {
    available:true,
    mintAuthority:null,
    freezeAuthority:null,
    concentrationAvailable:true,
    top1Percent:12,
    top5Percent:31,
    top10Percent:54,
    ownerConcentrationAvailable:false,
    sources:{accountInfo:true,largestAccounts:true,tokenSupply:true},
  }
}

test('normalizes RugCheck report into concrete evidence fields',()=>{
  const normalized=normalizeRugcheckReport({
    rugged:false,
    score:2450,
    token:{mintAuthority:null,freezeAuthority:null},
    topHolders:[
      {pct:18,insider:true},
      {pct:10,insider:false},
      {pct:8,insider:true},
      {pct:6,insider:false},
      {pct:5,insider:false},
      {pct:4,insider:false},
      {pct:3,insider:false},
      {pct:3,insider:false},
      {pct:2,insider:false},
      {pct:2,insider:false},
    ],
    risks:[
      {name:'Low Liquidity',level:'warn',score:200,description:'Thin pool'},
      {name:'Freeze Authority',level:'danger',score:900,description:'Authority retained'},
    ],
    totalMarketLiquidity:42000,
    totalHolders:814,
    verification:{jup_verified:true},
    markets:[{lp:{lpLockedPct:91}}],
  })

  assert.equal(normalized.available,true)
  assert.equal(normalized.mintAuthorityDisabled,true)
  assert.equal(normalized.freezeAuthorityDisabled,true)
  assert.equal(normalized.top1Percent,18)
  assert.equal(normalized.top5Percent,47)
  assert.equal(normalized.top10Percent,61)
  assert.equal(normalized.insiderPercent,26)
  assert.equal(normalized.dangerRiskCount,1)
  assert.deepEqual(normalized.structuralRiskNames,['Freeze Authority'])
  assert.equal(normalized.lpLockedPercent,91)
  assert.equal(normalized.jupiterVerified,true)
})

test('authority consensus is corroborated when independent providers agree',()=>{
  const merged=mergeSecurityEvidence(onchainSafe(),{
    rugcheck:{
      available:true,
      mintAuthorityDisabled:true,
      freezeAuthorityDisabled:true,
      dangerRiskCount:0,
      warningRiskCount:0,
      structuralRiskNames:[],
      rugged:false,
      top1Percent:13,
      top5Percent:32,
      top10Percent:55,
    },
    jupiter:{
      available:true,
      mintAuthorityDisabled:true,
      freezeAuthorityDisabled:true,
      organicScore:72,
      isVerified:true,
    },
  })

  assert.equal(merged.external.providerCount,3)
  assert.equal(merged.external.authority.corroboratedSafe,true)
  assert.deepEqual(merged.external.dataConflicts,[])
  assert.equal(merged.external.jupiterOrganicScore,72)
  assert.equal(merged.external.jupiterVerified,true)
})

test('authority disagreement is preserved as a conflict instead of treated safe',()=>{
  const merged=mergeSecurityEvidence(onchainSafe(),{
    rugcheck:{
      available:true,
      mintAuthorityDisabled:false,
      freezeAuthorityDisabled:true,
      dangerRiskCount:0,
      warningRiskCount:0,
      structuralRiskNames:[],
      rugged:false,
    },
    jupiter:{available:false},
  })

  assert.ok(merged.external.dataConflicts.includes('MINT_AUTHORITY_CONFLICT'))
  assert.equal(merged.external.authority.mint.conflict,true)
  assert.equal(merged.external.authority.corroboratedSafe,false)
})

test('large holder-data disagreements lower evidence quality',()=>{
  const merged=mergeSecurityEvidence(onchainSafe(),{
    rugcheck:{
      available:true,
      mintAuthorityDisabled:true,
      freezeAuthorityDisabled:true,
      top1Percent:45,
      top5Percent:65,
      top10Percent:90,
      dangerRiskCount:0,
      warningRiskCount:0,
      structuralRiskNames:[],
      rugged:false,
    },
    jupiter:{available:false},
  })

  assert.ok(merged.external.dataConflicts.includes('TOP1_CONCENTRATION_CONFLICT'))
  assert.ok(merged.external.dataConflicts.includes('TOP10_CONCENTRATION_CONFLICT'))
  assert.ok(merged.external.evidenceScore<70)
})

test('normalizes Jupiter token evidence',()=>{
  const normalized=normalizeJupiterToken([{
    id:'TokenMint111111111111111111111111111111111',
    isVerified:true,
    organicScore:84,
    organicScoreLabel:'high',
    holderCount:1500,
    liquidity:220000,
    mcap:1700000,
    audit:{
      isSus:false,
      mintAuthorityDisabled:true,
      freezeAuthorityDisabled:true,
    },
  }],'TokenMint111111111111111111111111111111111')

  assert.equal(normalized.available,true)
  assert.equal(normalized.isVerified,true)
  assert.equal(normalized.suspicious,false)
  assert.equal(normalized.organicScore,84)
  assert.equal(normalized.mintAuthorityDisabled,true)
  assert.equal(normalized.freezeAuthorityDisabled,true)
})

test('Jupiter isSus must be true before RCXT treats it as suspicious',()=>{
  const address='TokenMint111111111111111111111111111111111'
  const safe=normalizeJupiterToken([{id:address,audit:{isSus:false}}],address)
  const suspicious=normalizeJupiterToken([{id:address,audit:{isSus:true}}],address)

  assert.equal(safe.suspicious,false)
  assert.equal(suspicious.suspicious,true)
})


test('normalizes GoPlus Solana security functions and holder concentration',()=>{
  const address='Mint11111111111111111111111111111111111111'
  const normalized=normalizeGoPlusSolana({
    result:{
      [address]:{
        mintable:{status:'0'},
        freezable:{status:'0'},
        metadata_mutable:{status:'1'},
        blacklist:{status:'0'},
        transfer_pausable:{status:'0'},
        default_account_state:'1',
        holder_count:'1234',
        creator_percent:'0.08',
        holders:[
          {percent:'0.12'},
          {percent:'0.08'},
          {percent:'0.06'},
          {percent:'0.05'},
          {percent:'0.04'},
          {percent:'0.04'},
          {percent:'0.03'},
          {percent:'0.03'},
          {percent:'0.02'},
          {percent:'0.02'},
        ],
      },
    },
  },address)

  assert.equal(normalized.available,true)
  assert.equal(normalized.mintAuthorityDisabled,true)
  assert.equal(normalized.freezeAuthorityDisabled,true)
  assert.equal(normalized.metadataMutable,true)
  assert.equal(normalized.top1Percent,12)
  assert.equal(normalized.top10Percent,49)
  assert.equal(normalized.creatorPercent,8)
})

test('normalizes Birdeye Solana authority and Token-2022 risk fields',()=>{
  const normalized=normalizeBirdeyeSecurity({
    data:{
      ownerAddress:null,
      freezeAuthority:null,
      freezeable:false,
      mutableMetadata:true,
      transferFeeEnable:true,
      isToken2022:true,
      creatorPercentage:0.12,
      top10HolderPercent:0.44,
      jupStrictList:true,
    },
  })

  assert.equal(normalized.available,true)
  assert.equal(normalized.mintAuthorityDisabled,true)
  assert.equal(normalized.freezeAuthorityDisabled,true)
  assert.equal(normalized.mutableMetadata,true)
  assert.equal(normalized.transferFeeEnabled,true)
  assert.equal(normalized.creatorPercent,12)
  assert.equal(normalized.top10Percent,44)
})

test('GoPlus and Birdeye add independent authority votes',()=>{
  const merged=mergeSecurityEvidence(onchainSafe(),{
    rugcheck:{available:false},
    jupiter:{available:false},
    goplus:{
      available:true,
      mintAuthorityDisabled:true,
      freezeAuthorityDisabled:true,
      top10Percent:55,
      metadataMutable:false,
      blacklistActive:false,
      transferPausable:false,
      defaultAccountFrozen:false,
    },
    birdeye:{
      available:true,
      mintAuthorityDisabled:true,
      freezeAuthorityDisabled:true,
      top10Percent:54,
      mutableMetadata:false,
      transferFeeEnabled:false,
    },
  })

  assert.equal(merged.external.providerCount,3)
  assert.equal(merged.external.authority.corroboratedSafe,true)
  assert.deepEqual(merged.external.dataConflicts,[])
  assert.equal(merged.sources.goplus,true)
  assert.equal(merged.sources.birdeye,true)
})

test('GoPlus blacklist is preserved as hard structural evidence',()=>{
  const merged=mergeSecurityEvidence(onchainSafe(),{
    rugcheck:{available:false},
    jupiter:{available:false},
    goplus:{
      available:true,
      mintAuthorityDisabled:true,
      freezeAuthorityDisabled:true,
      blacklistActive:true,
      transferPausable:false,
      defaultAccountFrozen:false,
    },
    birdeye:{available:false},
  })

  assert.ok(merged.external.hardRiskFlags.includes('GOPLUS_BLACKLIST'))
  assert.ok(merged.external.dangerRiskCount>=1)
})

test('Jupiter audit isSus presence is treated as suspicious signal',()=>{
  const address='Mint11111111111111111111111111111111111111'
  const normalized=normalizeJupiterToken([{
    id:address,
    isVerified:false,
    organicScore:12,
    audit:{isSus:false},
  }],address)

  assert.equal(normalized.available,true)
  assert.equal(normalized.suspicious,true)
})
