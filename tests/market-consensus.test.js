import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMarketConsensus,
  normalizeBirdeyeOverview,
  normalizeGeckoTerminalToken,
  normalizeHeliusAsset,
  normalizeJupiterPrice,
} from '../lib/market-consensus.js'

function pair(price=0.001){
  return {
    priceUsd:String(price),
    liquidity:{usd:50000},
  }
}

test('normalizes GeckoTerminal market data',()=>{
  const result=normalizeGeckoTerminalToken({
    data:{
      id:'solana_test',
      attributes:{
        price_usd:'0.00102',
        market_cap_usd:'1010000',
        fdv_usd:'1020000',
        total_reserve_in_usd:'52000',
        volume_usd:{h24:'225000'},
        price_change_percentage:{h24:'14.5'},
      },
    },
  })

  assert.equal(result.available,true)
  assert.equal(result.priceUsd,0.00102)
  assert.equal(result.liquidityUsd,52000)
  assert.equal(result.volume24hUsd,225000)
})

test('normalizes Jupiter Price V3 response',()=>{
  const address='Mint11111111111111111111111111111111111111'
  const result=normalizeJupiterPrice({
    [address]:{
      usdPrice:0.0025,
      blockId:400000000,
      decimals:6,
      priceChange24h:5.2,
    },
  },address)

  assert.equal(result.available,true)
  assert.equal(result.priceUsd,0.0025)
  assert.equal(result.blockId,400000000)
})

test('normalizes Helius fungible getAsset response',()=>{
  const result=normalizeHeliusAsset({
    result:{
      id:'Mint',
      interface:'FungibleToken',
      token_info:{
        supply:1000000000,
        decimals:6,
        token_program:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
        price_info:{price_per_token:0.0042},
      },
    },
  },'Mint')

  assert.equal(result.available,true)
  assert.equal(result.priceUsd,0.0042)
  assert.equal(result.decimals,6)
  assert.match(result.tokenProgram,/Tokenz/)
})

test('normalizes Birdeye overview response',()=>{
  const result=normalizeBirdeyeOverview({
    data:{
      price:0.00101,
      liquidity:49000,
      mc:990000,
      v24hUSD:300000,
      priceChange24hPercent:7.5,
      uniqueWallet24h:600,
      trade24h:2500,
    },
  })

  assert.equal(result.available,true)
  assert.equal(result.priceUsd,0.00101)
  assert.equal(result.marketCapUsd,990000)
  assert.equal(result.uniqueWallets24h,600)
})

test('market consensus rewards close independent prices',()=>{
  const result=buildMarketConsensus(pair(),{
    geckoterminal:{available:true,priceUsd:0.00102,liquidityUsd:51000},
    jupiterPrice:{available:true,priceUsd:0.00099},
    helius:{available:true,priceUsd:0.00101},
    birdeye:{available:false},
  })

  assert.equal(result.priceProviderCount,4)
  assert.equal(result.externalPriceProviderCount,3)
  assert.equal(result.priceAgreement,true)
  assert.equal(result.priceConflict,false)
  assert.ok(result.evidenceScore>=80)
})

test('market consensus flags material price disagreement',()=>{
  const result=buildMarketConsensus(pair(),{
    geckoterminal:{available:true,priceUsd:0.00101,liquidityUsd:50000},
    jupiterPrice:{available:true,priceUsd:0.0018},
    helius:{available:false},
    birdeye:{available:false},
  })

  assert.equal(result.priceConflict,true)
  assert.equal(result.priceAgreement,false)
  assert.ok(result.maxDeviationPercent>=12)
})

test('three-fold liquidity disagreement is recorded but not treated as price conflict',()=>{
  const result=buildMarketConsensus(pair(),{
    geckoterminal:{available:true,priceUsd:0.00101,liquidityUsd:180000},
    birdeye:{available:true,priceUsd:0.001,liquidityUsd:52000},
    jupiterPrice:{available:false},
    helius:{available:false},
  })

  assert.equal(result.liquidityConflict,true)
  assert.equal(result.priceConflict,false)
})
