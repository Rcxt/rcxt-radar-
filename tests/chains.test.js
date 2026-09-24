import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getChain,
  isAddressValidForChain,
  looksLikeEvmAddress,
  normalizeTokenAddress,
  SUPPORTED_CHAIN_IDS,
} from '../lib/chains.js'

const ROO='0x3458e003F6ED93df0F537b8AcaC6FbE08E41247f'

test('Robinhood Chain registry uses mainnet chain id 4663',()=>{
  const chain=getChain('robinhood')
  assert.equal(chain.chainId,4663)
  assert.equal(chain.family,'evm')
  assert.equal(chain.dexscreener,'robinhood')
  assert.equal(chain.geckoterminal,'robinhood')
  assert.equal(chain.goplus,'4663')
})

test('supported multichain registry includes major RCXT scan networks',()=>{
  for(const id of ['solana','robinhood','ethereum','base','bsc','arbitrum','polygon','optimism','avalanche','monad']){
    assert.ok(SUPPORTED_CHAIN_IDS.includes(id))
  }
})

test('EVM address validation and normalization are chain aware',()=>{
  assert.equal(looksLikeEvmAddress(ROO),true)
  assert.equal(isAddressValidForChain(ROO,getChain('robinhood')),true)
  assert.equal(isAddressValidForChain(ROO,getChain('solana')),false)
  assert.equal(normalizeTokenAddress(ROO,getChain('robinhood')),ROO.toLowerCase())
})
