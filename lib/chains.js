export const CHAIN_REGISTRY={
  solana:{
    id:'solana',label:'Solana',family:'solana',dexscreener:'solana',geckoterminal:'solana',
    goplus:null,explorer:'https://solscan.io/token/',accountExplorer:'https://solscan.io/account/',bubbleMap:'solana',
  },
  robinhood:{
    id:'robinhood',label:'Robinhood Chain',family:'evm',chainId:4663,dexscreener:'robinhood',geckoterminal:'robinhood',
    goplus:'4663',rpc:'https://rpc.mainnet.chain.robinhood.com',explorer:'https://robinhoodchain.blockscout.com/token/',accountExplorer:'https://robinhoodchain.blockscout.com/address/',
  },
  ethereum:{
    id:'ethereum',label:'Ethereum',family:'evm',chainId:1,dexscreener:'ethereum',geckoterminal:'eth',
    goplus:'1',rpc:'https://cloudflare-eth.com',explorer:'https://etherscan.io/token/',accountExplorer:'https://etherscan.io/address/',
  },
  base:{
    id:'base',label:'Base',family:'evm',chainId:8453,dexscreener:'base',geckoterminal:'base',
    goplus:'8453',rpc:'https://mainnet.base.org',explorer:'https://basescan.org/token/',accountExplorer:'https://basescan.org/address/',
  },
  bsc:{
    id:'bsc',label:'BNB Chain',family:'evm',chainId:56,dexscreener:'bsc',geckoterminal:'bsc',
    goplus:'56',rpc:'https://bsc-dataseed.binance.org',explorer:'https://bscscan.com/token/',accountExplorer:'https://bscscan.com/address/',
  },
  arbitrum:{
    id:'arbitrum',label:'Arbitrum',family:'evm',chainId:42161,dexscreener:'arbitrum',geckoterminal:'arbitrum',
    goplus:'42161',rpc:'https://arb1.arbitrum.io/rpc',explorer:'https://arbiscan.io/token/',accountExplorer:'https://arbiscan.io/address/',
  },
  polygon:{
    id:'polygon',label:'Polygon',family:'evm',chainId:137,dexscreener:'polygon',geckoterminal:'polygon_pos',
    goplus:'137',rpc:'https://polygon-rpc.com',explorer:'https://polygonscan.com/token/',accountExplorer:'https://polygonscan.com/address/',
  },
  optimism:{
    id:'optimism',label:'Optimism',family:'evm',chainId:10,dexscreener:'optimism',geckoterminal:'optimism',
    goplus:'10',rpc:'https://mainnet.optimism.io',explorer:'https://optimistic.etherscan.io/token/',accountExplorer:'https://optimistic.etherscan.io/address/',
  },
  avalanche:{
    id:'avalanche',label:'Avalanche',family:'evm',chainId:43114,dexscreener:'avalanche',geckoterminal:'avax',
    goplus:'43114',rpc:'https://api.avax.network/ext/bc/C/rpc',explorer:'https://snowtrace.io/token/',accountExplorer:'https://snowtrace.io/address/',
  },
  monad:{
    id:'monad',label:'Monad',family:'evm',chainId:143,dexscreener:'monad',geckoterminal:'monad',
    goplus:'143',rpc:null,explorer:'https://monadscan.com/token/',accountExplorer:'https://monadscan.com/address/',
  },
}

export const SUPPORTED_CHAIN_IDS=Object.keys(CHAIN_REGISTRY)

export function getChain(id='solana'){
  const key=String(id||'').trim().toLowerCase()
  return CHAIN_REGISTRY[key]||null
}

export function listChains(){
  return SUPPORTED_CHAIN_IDS.map((id)=>CHAIN_REGISTRY[id])
}

export function looksLikeEvmAddress(value){
  return typeof value==='string'&&/^0x[a-fA-F0-9]{40}$/.test(value.trim())
}

export function normalizeTokenAddress(address,chain){
  const value=String(address||'').trim()
  return chain?.family==='evm'?value.toLowerCase():value
}

export function isAddressValidForChain(address,chain){
  if(!chain) return false
  const value=String(address||'').trim()
  if(chain.family==='evm') return looksLikeEvmAddress(value)
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
}

export function chainFromDexId(value){
  const dex=String(value||'').toLowerCase()
  return Object.values(CHAIN_REGISTRY).find((chain)=>chain.dexscreener===dex)||null
}
