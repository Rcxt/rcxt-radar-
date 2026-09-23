const USDC='EPjFWdd5AufqSSqeM2q9kwWBK6GfYxkKc8uYNxgXzV'
const USDT='Es9vMFrzaCERmJfrF4H2FYD9Wg9kNnYFhXqGqKqMGV'
const WSOL='So11111111111111111111111111111111111111112'

export const STABLE_MINTS=new Set([USDC,USDT])
export const WRAPPED_SOL_MINT=WSOL

function pubkeyValue(key){
  if(typeof key==='string') return key
  return key?.pubkey || key?.pubKey || null
}

function tokenAmount(balance){
  const value=balance?.uiTokenAmount?.uiAmountString ?? balance?.uiTokenAmount?.uiAmount ?? '0'
  const n=Number(value)
  return Number.isFinite(n)?n:0
}

function ownedBalances(list,address){
  const out=new Map()
  for(const row of list||[]){
    if(row?.owner && row.owner!==address) continue
    if(!row?.mint) continue
    out.set(row.mint,{
      mint:row.mint,
      amount:tokenAmount(row),
      decimals:Number(row?.uiTokenAmount?.decimals||0),
    })
  }
  return out
}

export function classifyWalletActivity(changes,solDelta){
  const meaningful=(changes||[]).filter(change=>Math.abs(Number(change?.delta||0))>0)
  const gained=meaningful.filter(change=>change.delta>0)
  const lost=meaningful.filter(change=>change.delta<0)
  const gainedStable=gained.some(change=>STABLE_MINTS.has(change.mint))
  const lostStable=lost.some(change=>STABLE_MINTS.has(change.mint))
  const gainedTrade=gained.some(change=>!STABLE_MINTS.has(change.mint)&&change.mint!==WRAPPED_SOL_MINT)
  const lostTrade=lost.some(change=>!STABLE_MINTS.has(change.mint)&&change.mint!==WRAPPED_SOL_MINT)

  if(gainedTrade && (lostStable || solDelta < -0.00005)) return 'BUY'
  if(lostTrade && (gainedStable || solDelta > 0.00005)) return 'SELL'
  if(gained.length && lost.length) return 'SWAP'
  if(gained.length) return 'RECEIVE'
  if(lost.length) return 'SEND'
  return 'OTHER'
}

export function primaryActivityMint(changes,type){
  const candidates=(changes||[]).filter(change=>{
    if(STABLE_MINTS.has(change.mint)||change.mint===WRAPPED_SOL_MINT) return false
    if(type==='BUY'||type==='RECEIVE') return change.delta>0
    if(type==='SELL'||type==='SEND') return change.delta<0
    return true
  })
  return candidates.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta))[0]?.mint || null
}

export function parseWalletTransaction(tx,address){
  if(!tx?.meta||!tx?.transaction?.message) return null
  const keys=(tx.transaction.message.accountKeys||[]).map(pubkeyValue)
  const walletIndex=keys.indexOf(address)
  const preSol=walletIndex>=0?Number(tx.meta.preBalances?.[walletIndex]||0):0
  const postSol=walletIndex>=0?Number(tx.meta.postBalances?.[walletIndex]||0):0
  let solDelta=(postSol-preSol)/1e9

  // Add the network fee back for classification so a pure receive does not look
  // like a purchase just because the wallet paid a transaction fee.
  if(walletIndex===0 && Number(tx.meta.fee||0)>0){
    solDelta+=Number(tx.meta.fee)/1e9
  }

  const pre=ownedBalances(tx.meta.preTokenBalances,address)
  const post=ownedBalances(tx.meta.postTokenBalances,address)
  const mints=new Set([...pre.keys(),...post.keys()])
  const changes=[]

  for(const mint of mints){
    const before=pre.get(mint)?.amount||0
    const after=post.get(mint)?.amount||0
    const delta=after-before
    if(Math.abs(delta)<1e-12) continue
    changes.push({
      mint,
      before,
      after,
      delta,
      decimals:post.get(mint)?.decimals??pre.get(mint)?.decimals??0,
    })
  }

  if(!changes.length) return null
  const type=classifyWalletActivity(changes,solDelta)
  const mint=primaryActivityMint(changes,type)

  return {
    signature:tx.transaction.signatures?.[0]||null,
    blockTime:tx.blockTime?new Date(tx.blockTime*1000).toISOString():null,
    slot:tx.slot||null,
    type,
    primaryMint:mint,
    solDelta:Number(solDelta.toFixed(9)),
    feeSol:Number((Number(tx.meta.fee||0)/1e9).toFixed(9)),
    changes,
    failed:Boolean(tx.meta.err),
  }
}
