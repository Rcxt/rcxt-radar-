import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeCandles } from '../lib/market-analytics.js'

function candles({count=80,start=1,step=0.01,volume=1000}={}){
  const rows=[]
  let price=start
  for(let i=0;i<count;i+=1){
    const open=price
    const close=Math.max(0.000001,price+step)
    const high=Math.max(open,close)*1.01
    const low=Math.min(open,close)*0.99
    rows.push({
      timestamp:1_790_000_000+i*300,
      open,
      high,
      low,
      close,
      volume:volume+i*5,
    })
    price=close
  }
  return rows
}

test('analyzeCandles returns structured analytics',()=>{
  const result=analyzeCandles(candles(),{intervalMinutes:5})
  assert.equal(result.available,true)
  assert.equal(result.sampleSize,80)
  assert.ok(['BULLISH','MIXED','BEARISH'].includes(result.trend))
  assert.ok(result.dataQuality>=0&&result.dataQuality<=100)
  assert.ok(result.modelConfidence>=0&&result.modelConfidence<=100)
  assert.ok(Number.isFinite(result.indicators.vwap20))
  assert.ok(Number.isFinite(result.indicators.bollingerWidthPercent))
  assert.ok(result.forecast?.h1)
})

test('bullish synthetic candles should not classify as bearish',()=>{
  const result=analyzeCandles(candles({step:0.02}),{intervalMinutes:5})
  assert.notEqual(result.trend,'BEARISH')
})

test('bearish synthetic candles should not classify as bullish',()=>{
  const result=analyzeCandles(candles({start:5,step:-0.02}),{intervalMinutes:5})
  assert.notEqual(result.trend,'BULLISH')
})

test('insufficient candle history is explicitly unavailable',()=>{
  const result=analyzeCandles(candles({count:3}),{intervalMinutes:5})
  assert.equal(result.available,false)
  assert.ok(result.reason)
})


test('flat candles report neutral RSI instead of false overbought',()=>{
  const result=analyzeCandles(candles({count:40,start:1,step:0}),{intervalMinutes:5})
  assert.equal(result.available,true)
  assert.equal(result.indicators.rsi14,50)
})

test('chart horizons stay unavailable until enough real history exists',()=>{
  const result=analyzeCandles(candles({count:10,start:1,step:0.01}),{intervalMinutes:5})
  assert.equal(result.available,true)
  assert.ok(Number.isFinite(result.momentum.m15))
  assert.equal(result.momentum.h1,null)
  assert.equal(result.momentum.h6,null)
})
