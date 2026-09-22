const CACHE_TTL = 45_000
const cache = new Map()

function cached(key) {
  const item = cache.get(key)
  return item && Date.now() - item.time < CACHE_TTL ? item.value : null
}
function put(key, value) {
  cache.set(key,{time:Date.now(),value})
  if(cache.size>150) cache.delete(cache.keys().next().value)
}
function safeText(value,max=1200){ return String(value||'').slice(0,max) }
function recencyWeight(timestamp){
  const ageH=Math.max(0,(Date.now()-new Date(timestamp).getTime())/3_600_000)
  if(ageH<=1) return 1
  if(ageH<=6) return .8
  if(ageH<=24) return .55
  return .25
}
function normalizeTerms({address,symbol,name}){
  const terms=[address, symbol && '$'+symbol, symbol, name].filter(Boolean)
  return [...new Set(terms.map(x=>String(x).trim()).filter(x=>x.length>=2))].slice(0,4)
}
function queryString(terms){
  return terms.map(t=>/s/.test(t)?`"${t.replaceAll('"','')}"`:t).join(' OR ')
}
function textFingerprint(text){
  return safeText(text,240).toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/[^a-z0-9]+/g,' ').trim().slice(0,140)
}
function sentiment(text){
  const t=String(text||'').toLowerCase()
  const positive=['bullish','breakout','buying','accumulating','strong','send','moon','gem','growth','uptrend','based']
  const negative=['rug','scam','dump','dead','sell','bearish','warning','honeypot','exit','collapse','fake']
  let score=0
  for(const w of positive) if(t.includes(w)) score+=1
  for(const w of negative) if(t.includes(w)) score-=1
  return Math.max(-3,Math.min(3,score))
}
function summarizePosts(source,posts){
  const valid=(posts||[]).filter(p=>p&&p.text)
  const fingerprints=new Map()
  for(const post of valid){
    const fp=textFingerprint(post.text)
    if(fp) fingerprints.set(fp,(fingerprints.get(fp)||0)+1)
  }
  const duplicatePosts=[...fingerprints.values()].reduce((sum,count)=>sum+Math.max(0,count-1),0)
  const duplicateRatio=valid.length?duplicatePosts/valid.length:0
  const uniqueAuthors=new Set(valid.map(p=>p.author).filter(Boolean)).size
  const totalEngagement=valid.reduce((s,p)=>s+Number(p.engagement||0),0)
  const weightedMentions=valid.reduce((s,p)=>s+recencyWeight(p.timestamp),0)
  const sentimentSum=valid.reduce((s,p)=>s+sentiment(p.text),0)
  const sentimentScore=valid.length?sentimentSum/(valid.length*3):0
  return {
    source,
    available:true,
    mentionCount:valid.length,
    weightedMentions:Number(weightedMentions.toFixed(2)),
    uniqueAuthors,
    engagement:totalEngagement,
    sentiment:Number(sentimentScore.toFixed(3)),
    duplicateRatio:Number(duplicateRatio.toFixed(3)),
    latestAt:valid.map(p=>p.timestamp).filter(Boolean).sort().at(-1)||null,
    posts:valid.slice(0,8),
  }
}

async function fetchJson(url,options={}){
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(4500)})
  if(!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function scanReddit(input){
  const token=process.env.REDDIT_BEARER_TOKEN
  if(!token) return {source:'reddit',available:false,reason:'REDDIT_BEARER_TOKEN not configured'}
  const terms=normalizeTerms(input)
  if(!terms.length) return {source:'reddit',available:false,reason:'No search terms'}
  const q=encodeURIComponent(queryString(terms))
  try{
    const data=await fetchJson(`https://oauth.reddit.com/search?q=${q}&sort=new&t=day&limit=50&raw_json=1`,{
      headers:{Authorization:`Bearer ${token}`,'User-Agent':'RCXT-Radar/3.0'}
    })
    const posts=(data?.data?.children||[]).map(({data:p})=>({
      id:p?.id,
      text:`${p?.title||''}\n${p?.selftext||''}`,
      author:p?.author||null,
      engagement:Number(p?.score||0)+Number(p?.num_comments||0)*2,
      timestamp:p?.created_utc?new Date(p.created_utc*1000).toISOString():null,
      url:p?.permalink?`https://www.reddit.com${p.permalink}`:null,
    }))
    return summarizePosts('reddit',posts)
  }catch(error){
    return {source:'reddit',available:false,reason:error?.message||'Reddit request failed'}
  }
}

export async function scanX(input){
  const token=process.env.X_BEARER_TOKEN
  if(!token) return {source:'x',available:false,reason:'X_BEARER_TOKEN not configured'}
  const terms=normalizeTerms(input)
  if(!terms.length) return {source:'x',available:false,reason:'No search terms'}
  const q=encodeURIComponent(`(${queryString(terms)}) -is:retweet lang:en`)
  try{
    const data=await fetchJson(`https://api.x.com/2/tweets/search/recent?query=${q}&max_results=50&tweet.fields=created_at,public_metrics,author_id,text`,{
      headers:{Authorization:`Bearer ${token}`}
    })
    const posts=(data?.data||[]).map(p=>({
      id:p?.id,
      text:p?.text||'',
      author:p?.author_id||null,
      engagement:Number(p?.public_metrics?.like_count||0)+Number(p?.public_metrics?.reply_count||0)*2+Number(p?.public_metrics?.retweet_count||0)*2,
      timestamp:p?.created_at||null,
      url:p?.id?`https://x.com/i/web/status/${p.id}`:null,
    }))
    return summarizePosts('x',posts)
  }catch(error){
    return {source:'x',available:false,reason:error?.message||'X request failed'}
  }
}

export async function scanInstagram(input){
  const access=process.env.INSTAGRAM_ACCESS_TOKEN
  const userId=process.env.INSTAGRAM_USER_ID
  if(!access||!userId) return {source:'instagram',available:false,reason:'Instagram Graph credentials not configured'}
  const term=(input.symbol||input.name||'').replace(/[^a-zA-Z0-9_]/g,'').slice(0,60)
  if(!term) return {source:'instagram',available:false,reason:'No hashtag-compatible search term'}
  try{
    const search=await fetchJson(`https://graph.facebook.com/v24.0/ig_hashtag_search?user_id=${encodeURIComponent(userId)}&q=${encodeURIComponent(term)}&access_token=${encodeURIComponent(access)}`)
    const id=search?.data?.[0]?.id
    if(!id) return summarizePosts('instagram',[])
    const data=await fetchJson(`https://graph.facebook.com/v24.0/${id}/recent_media?user_id=${encodeURIComponent(userId)}&fields=id,caption,comments_count,like_count,permalink,timestamp&limit=50&access_token=${encodeURIComponent(access)}`)
    const posts=(data?.data||[]).map(p=>({
      id:p?.id,
      text:p?.caption||'',
      author:null,
      engagement:Number(p?.like_count||0)+Number(p?.comments_count||0)*2,
      timestamp:p?.timestamp||null,
      url:p?.permalink||null,
    }))
    return summarizePosts('instagram',posts)
  }catch(error){
    return {source:'instagram',available:false,reason:error?.message||'Instagram request failed'}
  }
}

export function aggregateSocial(results){
  const available=(results||[]).filter(r=>r?.available)
  const mentions=available.reduce((s,r)=>s+r.mentionCount,0)
  const weighted=available.reduce((s,r)=>s+r.weightedMentions,0)
  const engagement=available.reduce((s,r)=>s+r.engagement,0)
  const uniqueAuthors=available.reduce((s,r)=>s+r.uniqueAuthors,0)
  const duplicateRatio=available.length?available.reduce((s,r)=>s+r.duplicateRatio,0)/available.length:0
  const sentimentScore=available.length?available.reduce((s,r)=>s+r.sentiment,0)/available.length:0
  const sourceDiversity=available.length

  let momentum=50
  momentum += Math.min(18,Math.log10(1+weighted)*10)
  momentum += Math.min(10,Math.log10(1+engagement)*3.5)
  momentum += Math.min(8,Math.log10(1+uniqueAuthors)*4)
  momentum += sentimentScore*12
  momentum -= duplicateRatio*25
  if(sourceDiversity>=2) momentum+=6
  if(sourceDiversity===0) momentum=0
  momentum=Math.round(Math.max(0,Math.min(100,momentum)))

  const quality=Math.round(Math.max(0,Math.min(100,
    sourceDiversity*22 + Math.min(28,uniqueAuthors*2) + Math.min(20,mentions) - duplicateRatio*35
  )))

  return {
    available:sourceDiversity>0,
    sourceDiversity,
    mentionCount:mentions,
    weightedMentions:Number(weighted.toFixed(2)),
    uniqueAuthors,
    engagement,
    sentiment:Number(sentimentScore.toFixed(3)),
    duplicateRatio:Number(duplicateRatio.toFixed(3)),
    momentumScore:momentum,
    qualityScore:quality,
    providers:results,
  }
}

export async function getSocialIntel(input){
  const key=JSON.stringify(normalizeTerms(input))
  const hit=cached(key)
  if(hit) return hit
  const results=await Promise.all([scanReddit(input),scanX(input),scanInstagram(input)])
  const value=aggregateSocial(results)
  put(key,value)
  return value
}
