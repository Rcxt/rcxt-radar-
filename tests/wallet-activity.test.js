import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyWalletActivity,
  parseWalletTransaction,
  STABLE_MINTS,
} from '../lib/wallet-activity.js'

const TOKEN_A='9HB7uiNQeWTGG1tkuGaMQLhdt9Lg6vmJ4vtLJc1Wpump'
const TOKEN_B='8bFvxaMqvf3kxNtuZwgiD4Sw8iqj6SWGonn3wvRwLMgY'
const USDC=[...STABLE_MINTS][0]
const WALLET='976CYJJEVhntZhKS5wdUb3mz2w8FxViDbfCWK8xg2eQ7'

test('classifies token gain plus SOL spend as BUY',()=>{
  const type=classifyWalletActivity([{mint:TOKEN_A,delta:100}],-0.5)
  assert.equal(type,'BUY')
})

test('classifies token loss plus SOL receipt as SELL',()=>{
  const type=classifyWalletActivity([{mint:TOKEN_A,delta:-100}],0.5)
  assert.equal(type,'SELL')
})

test('classifies stablecoin spend plus token gain as BUY',()=>{
  const type=classifyWalletActivity([
    {mint:USDC,delta:-25},
    {mint:TOKEN_A,delta:5000},
  ],0)
  assert.equal(type,'BUY')
})

test('classifies token-to-token movement without SOL evidence as SWAP',()=>{
  const type=classifyWalletActivity([
    {mint:TOKEN_A,delta:-100},
    {mint:TOKEN_B,delta:250},
  ],0)
  assert.equal(type,'SWAP')
})

test('classifies token-only inflow as RECEIVE',()=>{
  const type=classifyWalletActivity([{mint:TOKEN_A,delta:100}],0)
  assert.equal(type,'RECEIVE')
})

test('fee-paying receive is not mislabeled as a BUY',()=>{
  const tx={
    slot:123,
    blockTime:1790122000,
    transaction:{
      signatures:['abc123'],
      message:{
        accountKeys:[
          {pubkey:WALLET,signer:true,writable:true},
        ],
      },
    },
    meta:{
      err:null,
      fee:5000,
      preBalances:[1_000_000_000],
      postBalances:[999_995_000],
      preTokenBalances:[
        {
          owner:WALLET,
          mint:TOKEN_A,
          uiTokenAmount:{uiAmountString:'0',decimals:6},
        },
      ],
      postTokenBalances:[
        {
          owner:WALLET,
          mint:TOKEN_A,
          uiTokenAmount:{uiAmountString:'100',decimals:6},
        },
      ],
    },
  }

  const event=parseWalletTransaction(tx,WALLET)
  assert.ok(event)
  assert.equal(event.type,'RECEIVE')
  assert.equal(event.solDelta,0)
  assert.equal(event.primaryMint,TOKEN_A)
})
