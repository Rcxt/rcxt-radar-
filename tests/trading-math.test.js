import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEntryQuality,
  buildExecutionChecklist,
  buildProfitLadder,
  buildRugRiskChecklist,
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

test('profit ladder returns no incomplete rows when investment is blank or zero',()=>{
  const blank=buildProfitLadder({
    investment:'',
    entryMarketCap:12000,
    estimatedCostsPercent:1,
  })
  const zero=buildProfitLadder({
    investment:0,
    entryMarketCap:12000,
    estimatedCostsPercent:1,
  })

  assert.deepEqual(blank,[])
  assert.deepEqual(zero,[])
})

test('every profit ladder row contains finite projection fields',()=>{
  const rows=buildProfitLadder({
    investment:20,
    entryMarketCap:12000,
    estimatedCostsPercent:1,
  })
  assert.ok(rows.length>0)
  assert.ok(rows.every(row=>Number.isFinite(row.multiple)))
  assert.ok(rows.every(row=>Number.isFinite(row.netValue)))
  assert.ok(rows.every(row=>Number.isFinite(row.netProfit)))
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


test('entry quality penalizes multi-whale distribution and concentration',()=>{
  const result=buildEntryQuality({
    scan:{
      market:{liquidityUsd:60000},
      intelligence:{risk:'MEDIUM'},
    },
    analytics:{
      available:true,
      levels:{
        structureRiskReward:1.5,
        downsideToSupportPercent:-8,
        upsideToResistancePercent:20,
      },
      indicators:{
        vwapDistancePercent:2,
        atrPercent:5,
      },
      momentum:{m15:5},
    },
    tape:{
      netFlowUsd:-5000,
      buyVolumePercent:38,
      flags:['MULTI_WHALE_DISTRIBUTION','WHALE_FLOW_CONCENTRATED'],
    },
  })
  assert.ok(result.available)
  assert.ok(result.score<60)
  assert.ok(result.warnings.some(value=>value.toLowerCase().includes('distribution')))
})

test('entry quality can recognize diversified whale accumulation as supporting context',()=>{
  const base={
    scan:{
      market:{liquidityUsd:90000},
      intelligence:{risk:'LOW'},
    },
    analytics:{
      available:true,
      levels:{
        structureRiskReward:2.2,
        downsideToSupportPercent:-7,
        upsideToResistancePercent:24,
      },
      indicators:{
        vwapDistancePercent:3,
        atrPercent:5,
      },
      momentum:{m15:8},
    },
  }

  const withoutWhales=buildEntryQuality({
    ...base,
    tape:{
      netFlowUsd:7000,
      buyVolumePercent:61,
      flags:[],
    },
  })

  const withWhales=buildEntryQuality({
    ...base,
    tape:{
      netFlowUsd:7000,
      buyVolumePercent:61,
      flags:['MULTI_WHALE_ACCUMULATION'],
    },
  })

  assert.ok(withWhales.available)
  assert.ok(withWhales.score>=withoutWhales.score)
  assert.ok(withWhales.score>=75)
})


test('rug guard treats unreported Pump.fun liquidity as unknown, not critical',()=>{
  const result=buildRugRiskChecklist({
    scan:{
      market:{liquidityUsd:null,marketCap:12000,priceChange:{h1:20,h24:200}},
      security:{available:true,mintAuthority:null,freezeAuthority:null},
      intelligence:{
        contractVerified:true,
        concentration:{available:false},
        liquidityReported:false,
        liquiditySource:'PUMPFUN_BONDING_CURVE_UNREPORTED',
        liquidityToCapPercent:null,
        turnover24h:null,
        ageHours:0.2,
        buyPercent1h:62,
      },
    },
    tape:null,
  })

  const liquidity=result.items.find(item=>item.key==='liquidity')
  const liqCap=result.items.find(item=>item.key==='liq-cap')
  const turnover=result.items.find(item=>item.key==='turnover')
  assert.equal(liquidity?.severity,'unknown')
  assert.equal(liqCap?.severity,'unknown')
  assert.equal(turnover?.severity,'unknown')
  assert.ok(!result.items.some(item=>item.key==='liquidity'&&item.severity==='critical'))
})


test('execution checklist keeps missing flow and momentum unknown',()=>{
  const result=buildExecutionChecklist({
    scan:{
      chain:{family:'evm'},
      market:{liquidityUsd:null,priceChange:{m5:null}},
      security:{available:true},
      intelligence:{contractVerified:false,setupScore:55,liquidityReported:false},
    },
    analytics:null,
    tape:{sampleSize:0,netFlowUsd:0,buyVolumePercent:null},
    positionSize:20,
  })
  const flow=result.items.find(item=>item.key==='flow')
  const chase=result.items.find(item=>item.key==='chase')
  const liquidity=result.items.find(item=>item.key==='liquidity')
  assert.equal(flow?.unknown,true)
  assert.equal(chase?.unknown,true)
  assert.equal(liquidity?.unknown,true)
  assert.equal(flow?.pass,false)
  assert.equal(chase?.pass,false)
})

test('rug guard treats missing age and momentum as unknown rather than critical or pass',()=>{
  const result=buildRugRiskChecklist({
    scan:{
      market:{liquidityUsd:20000,priceChange:{h1:null,h24:null}},
      security:{available:true,mintAuthority:null,freezeAuthority:null},
      intelligence:{
        liquidityReported:true,
        liquidityToCapPercent:null,
        turnover24h:null,
        ageHours:null,
        buyPercent1h:null,
        dataAvailability:{flow:{h1:false},momentum:{h1:false,h24:false}},
        concentration:{available:false},
      },
    },
    tape:{sampleSize:0,flags:[]},
  })
  assert.equal(result.items.find(item=>item.key==='age')?.severity,'unknown')
  assert.equal(result.items.find(item=>item.key==='seller-pressure')?.severity,'unknown')
  assert.equal(result.items.find(item=>item.key==='price-structure')?.severity,'unknown')
  assert.equal(result.items.find(item=>item.key==='liq-cap')?.severity,'unknown')
})
