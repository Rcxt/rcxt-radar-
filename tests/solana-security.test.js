import test from 'node:test'
import assert from 'node:assert/strict'
import { parseToken2022Extensions } from '../lib/solana.js'

test('parses Token-2022 transfer fee configuration',()=>{
  const result=parseToken2022Extensions({
    extensions:[{
      extension:'transferFeeConfig',
      state:{
        newerTransferFee:{
          transferFeeBasisPoints:750,
          maximumFee:'5000000',
        },
      },
    }],
  },{})

  assert.equal(result.available,true)
  assert.equal(result.transferFeeEnabled,true)
  assert.equal(result.transferFeeBasisPoints,750)
  assert.equal(result.maximumFeeRaw,'5000000')
})

test('parses permanent delegate and transfer hook authorities',()=>{
  const result=parseToken2022Extensions({
    extensions:[
      {
        extension:'permanentDelegate',
        state:{delegate:'11111111111111111111111111111111'},
      },
      {
        extension:'transferHook',
        state:{programId:'Vote111111111111111111111111111111111111111'},
      },
    ],
  },{})

  assert.equal(result.permanentDelegate,'11111111111111111111111111111111')
  assert.equal(result.transferHookProgramId,'Vote111111111111111111111111111111111111111')
})

test('parses frozen-default and non-transferable Token-2022 controls',()=>{
  const result=parseToken2022Extensions({
    extensions:[
      {extension:'defaultAccountState',state:{state:'frozen'}},
      {extension:'nonTransferable',state:{}},
    ],
  },{})

  assert.equal(result.defaultAccountFrozen,true)
  assert.equal(result.nonTransferable,true)
})

test('parses pausable and mint-close authority controls',()=>{
  const result=parseToken2022Extensions({
    extensions:[
      {
        extension:'pausable',
        state:{
          authority:'11111111111111111111111111111111',
          paused:true,
        },
      },
      {
        extension:'mintCloseAuthority',
        state:{closeAuthority:'Vote111111111111111111111111111111111111111'},
      },
    ],
  },{})

  assert.equal(result.paused,true)
  assert.equal(result.pauseAuthority,'11111111111111111111111111111111')
  assert.equal(result.mintCloseAuthority,'Vote111111111111111111111111111111111111111')
})

test('missing Token-2022 extension metadata stays unknown instead of unsafe',()=>{
  const result=parseToken2022Extensions({},{})

  assert.equal(result.available,false)
  assert.equal(result.transferFeeEnabled,false)
  assert.equal(result.permanentDelegate,null)
  assert.equal(result.defaultAccountFrozen,false)
})
