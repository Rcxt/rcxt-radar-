import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeSecurityEvidence,
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
      mintAuthorityDisabled:true,
      freezeAuthorityDisabled:true,
    },
  }],'TokenMint111111111111111111111111111111111')

  assert.equal(normalized.available,true)
  assert.equal(normalized.isVerified,true)
  assert.equal(normalized.organicScore,84)
  assert.equal(normalized.mintAuthorityDisabled,true)
  assert.equal(normalized.freezeAuthorityDisabled,true)
})
