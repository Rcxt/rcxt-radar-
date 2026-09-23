import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEntryQuality,
  buildProfitLadder,
  challengeStats,
  positionPlan,
  projectedPositionValue,
} from '../src/lib/trading-math.js'

test('projected position value scales with market cap ratio',()=>{
  const result=projectedPositionValue({
    investment:20,
    entryMarketCap:10000,
    targetMarketCap:50000,
    estimatedCostsPercent:0,
  })
  assert.ok(result)
  assert.equal(result.multiple,5)
  assert.equal(result.grossValue,100)
  assert.equal(result.netProfit,80)
})

test('position plan respects risk budget and account cap',()=>{
  const result=positionPlan({
    accountValue:100,
    riskPercent:2,
    stopDistancePercent:10,
  })
  assert.equal(result.riskBudget,2)
  assert.equal(result.positionSize,20)
  assert.equal(result.positionPercent,20)
})

test('profit ladder contains only targets above entry and ascending',()=>{
  const rows=buildProfitLadder({
    investment:40,
    entryMarketCap:12000,
    estimatedCostsPercent:1,
  })
  assert.ok(rows.length>0)
  assert.ok(rows.every(row=>row.targetMarketCap>12000))
  for(let i=1;i<rows.length;i+=1){
    assert.ok(rows[i].targetMarketCap>=rows[i-1].targetMarketCap)
  }
})

test('challenge stats calculate high-water drawdown safely',()=>{
  const stats=challengeStats(8,[
    {totalValueUsd:5},
    {totalValueUsd:12},
    {totalValueUsd:10},
  ])
  assert.equal(stats.highWater,12)
  assert.ok(stats.drawdownPercent<0)
  assert.equal(stats.goal,50000)
  assert.ok(stats.requiredMultiple>1)
})

test('entry quality penalizes thin liquidity and seller flow',()=>{
  const result=buildEntryQuality({
    scan:{
      market:{liquidityUsd:1500},
      intelligence:{risk:'EXTREME'},
    },
    analytics:{
      available:true,
      levels:{
        structureRiskReward:0.5,
        downsideToSupportPercent:-30,
        upsideToResistancePercent:10,
      },
      indicators:{
        vwapDistancePercent:25,
        atrPercent:20,
      },
      momentum:{m15:30},
    },
    tape:{
      netFlowUsd:-1000,
      buyVolumePercent:30,
      flags:['MICROTRADE_NOISE','REPEAT_WALLET_CHURN'],
    },
  })
  assert.ok(result.available)
  assert.ok(result.score<=45)
  assert.ok(result.warnings.length>0)
})

test('entry quality improves with healthy structure and flow',()=>{
  const result=buildEntryQuality({
    scan:{
      market:{liquidityUsd:80000},
      intelligence:{risk:'LOW'},
    },
    analytics:{
      available:true,
      levels:{
        structureRiskReward:2.5,
        downsideToSupportPercent:-8,
        upsideToResistancePercent:25,
      },
      indicators:{
        vwapDistancePercent:3,
        atrPercent:5,
      },
      momentum:{m15:8},
    },
    tape:{
      netFlowUsd:2500,
      buyVolumePercent:62,
      flags:[],
    },
  })
  assert.ok(result.available)
  assert.ok(result.score>=70)
  assert.ok(result.reasons.length>0)
})
