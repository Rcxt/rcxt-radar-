import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveScanVerdict } from '../src/lib/scan-verdict.js'

function baseScan(){
  return {
    security:{available:true},
    market:{consensus:{priceProviderCount:2,priceConflict:false}},
    intelligence:{
      signal:'BUY SETUP',
      risk:'LOWER',
      score:78,
      confidence:90,
      contractVerified:true,
      preliminary:false,
      executionScore:70,
      safetyScore:85,
      positives:['Healthy execution structure'],
      negatives:[],
      entryGate:{leanBuyMissing:[]},
      securityEvidence:{
        providerCount:2,
        rugged:false,
        dangerRiskCount:0,
        market:{priceProviderCount:2,priceConflict:false,liquidityConflict:false},
      },
    },
  }
}

test('simple verdict returns YES when current entry gates pass',()=>{
  const result=deriveScanVerdict(baseScan())
  assert.equal(result.verdict,'YES')
  assert.equal(result.checks.find(row=>row.label==='Contract')?.value,'PASS')
  assert.equal(result.checks.find(row=>row.label==='Market sources')?.value,'AGREE')
})

test('simple verdict returns WAIT when confirmation is incomplete',()=>{
  const scan=baseScan()
  scan.intelligence.signal='WATCH'
  scan.intelligence.contractVerified=false
  scan.intelligence.entryGate.leanBuyMissing=['Contract verification incomplete']
  const result=deriveScanVerdict(scan)
  assert.equal(result.verdict,'WAIT')
  assert.match(result.reason,/Contract verification incomplete/i)
})

test('simple verdict returns NO when structural danger vetoes setup',()=>{
  const scan=baseScan()
  scan.intelligence.securityEvidence.rugged=true
  scan.intelligence.negatives=['Rug evidence detected']
  const result=deriveScanVerdict(scan)
  assert.equal(result.verdict,'NO')
  assert.match(result.reason,/Rug evidence detected/i)
})

test('price conflict prevents YES even when score signal is constructive',()=>{
  const scan=baseScan()
  scan.intelligence.securityEvidence.market.priceConflict=true
  const result=deriveScanVerdict(scan)
  assert.equal(result.verdict,'WAIT')
  assert.equal(result.checks.find(row=>row.label==='Market sources')?.value,'PRICE CONFLICT')
})


test('one live price source cannot produce YES',()=>{
  const scan=baseScan()
  scan.intelligence.securityEvidence.market.priceProviderCount=1
  scan.market.consensus.priceProviderCount=1
  const result=deriveScanVerdict(scan)
  assert.equal(result.verdict,'WAIT')
  assert.equal(result.checks.find(row=>row.label==='Market sources')?.value,'PARTIAL')
})

test('one security source cannot produce YES',()=>{
  const scan=baseScan()
  scan.intelligence.securityEvidence.providerCount=1
  const result=deriveScanVerdict(scan)
  assert.equal(result.verdict,'WAIT')
})

test('liquidity-source conflict cannot produce YES',()=>{
  const scan=baseScan()
  scan.intelligence.securityEvidence.market.liquidityConflict=true
  const result=deriveScanVerdict(scan)
  assert.equal(result.verdict,'WAIT')
  assert.equal(result.checks.find(row=>row.label==='Market sources')?.value,'LIQ CONFLICT')
})
