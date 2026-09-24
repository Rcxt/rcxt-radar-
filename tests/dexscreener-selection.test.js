import test from 'node:test'
import assert from 'node:assert/strict'
import { hasMeaningfulChainAmbiguity, pickBestBasePair } from '../lib/dexscreener.js'

const TOKEN='0x1111111111111111111111111111111111111111'
const OTHER='0x2222222222222222222222222222222222222222'

function pair({base=TOKEN,quote=OTHER,liquidity=10000,volume=5000}={}){
  return {
    baseToken:{address:base,symbol:'BASE'},
    quoteToken:{address:quote,symbol:'QUOTE'},
    liquidity:{usd:liquidity},
    volume:{h24:volume},
  }
}

test('scanner never scores a quote-token pair as the requested asset',()=>{
  const result=pickBestBasePair([
    pair({base:OTHER,quote:TOKEN,liquidity:1_000_000}),
  ],TOKEN,'ethereum')

  assert.equal(result,null)
})

test('best-pair selection only compares exact base-token matches',()=>{
  const result=pickBestBasePair([
    pair({base:OTHER,quote:TOKEN,liquidity:5_000_000}),
    pair({base:TOKEN,quote:OTHER,liquidity:25_000}),
    pair({base:TOKEN,quote:OTHER,liquidity:80_000}),
  ],TOKEN,'ethereum')

  assert.equal(result.liquidity.usd,80_000)
  assert.equal(result.baseToken.address,TOKEN)
})

test('equal-liquidity pair selection prefers greater 24h activity',()=>{
  const result=pickBestBasePair([
    pair({liquidity:80_000,volume:5_000}),
    pair({liquidity:80_000,volume:25_000}),
  ],TOKEN,'ethereum')

  assert.equal(result.volume.h24,25_000)
})


test('auto-chain detection refuses a meaningful second deployment',()=>{
  const ambiguous=hasMeaningfulChainAmbiguity([
    {liquidityUsd:50_000,volume24hUsd:20_000},
    {liquidityUsd:12_000,volume24hUsd:8_000},
  ])
  assert.equal(ambiguous,true)
})

test('tiny dust deployment does not make auto-chain unusable',()=>{
  const ambiguous=hasMeaningfulChainAmbiguity([
    {liquidityUsd:50_000,volume24hUsd:20_000},
    {liquidityUsd:100,volume24hUsd:200},
  ])
  assert.equal(ambiguous,false)
})
