const CACHE_TTL_MS=5*60*1000
const PARTIAL_TTL_MS=15*1000
const cache=new Map()

async function rpcCall(url,method,params){
  const response=await fetch(url,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:'rcxt-evm',method,params}),
    cache:'no-store',
    signal:AbortSignal.timeout(4500),
  })
  if(!response.ok) throw new Error(`EVM RPC HTTP ${response.status}`)
  const data=await response.json()
  if(data?.error) throw new Error(data.error.message||'EVM RPC error')
  return data?.result
}

export async function getEvmSecurity(address,chain){
  const key=`${chain?.id||'evm'}:${String(address||'').toLowerCase()}`
  const cached=cache.get(key)
  if(cached&&Date.now()-cached.time<cached.ttlMs) return cached.value

  const base={
    available:false,
    securityModel:'evm-token',
    chainId:chain?.chainId??null,
    chain:chain?.id||null,
    source:'evm-rpc',
    contractCodePresent:null,
    sources:{evmRpc:false},
  }

  if(!chain?.rpc){
    cache.set(key,{time:Date.now(),ttlMs:PARTIAL_TTL_MS,value:base})
    return base
  }

  try{
    const code=await rpcCall(chain.rpc,'eth_getCode',[address,'latest'])
    const contractCodePresent=typeof code==='string'&&code!=='0x'&&code!=='0x0'
    const value={
      ...base,
      available:true,
      contractCodePresent,
      sources:{evmRpc:true},
    }
    cache.set(key,{time:Date.now(),ttlMs:CACHE_TTL_MS,value})
    return value
  }catch(error){
    const value={...base,error:String(error?.message||'EVM RPC unavailable').slice(0,140)}
    cache.set(key,{time:Date.now(),ttlMs:PARTIAL_TTL_MS,value})
    return value
  }
}
