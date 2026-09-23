import test from 'node:test'
import assert from 'node:assert/strict'

import { analyzeXPosts, buildXQuery } from '../lib/social-intel.js'

const identity={
  address:'Fo5L1FzuvesFKxMw7wxDHLQoUYxNwEKpF2j1v3uDpump',
  symbol:'SOMO',
  name:'StreamFomo',
}

function post(id,text,minutesAgo,author={}){
  return {
    id:String(id),
    text,
    timestamp:new Date(Date.now()-minutesAgo*60_000).toISOString(),
    language:'en',
    engagement:author.engagement??12,
    impressions:author.impressions??500,
    author:{
      id:'u'+id,
      username:author.username||'user'+id,
      name:author.name||'User '+id,
      verified:Boolean(author.verified),
      followers:author.followers??500,
      createdAt:new Date(Date.now()-(author.ageDays??500)*86_400_000).toISOString(),
    },
  }
}

test('X query uses CA, cashtag, name and excludes retweets',()=>{
  const query=buildXQuery(identity)
  assert.match(query,/Fo5L1Fzu/)
  assert.match(query,/\$SOMO/)
  assert.match(query,/"StreamFomo"/)
  assert.match(query,/-is:retweet/)
})

test('organic accelerating X chatter produces useful momentum without shill flag',()=>{
  const posts=[]
  for(let i=0;i<14;i+=1){
    posts.push(post(
      i,
      '$SOMO StreamFomo momentum is building on Solana and buyers are stepping in '+i,
      2+i,
      {followers:i===0?25000:700+i*100,verified:i===0,engagement:20+i}
    ))
  }

  const result=analyzeXPosts(posts,identity,{searchMode:'recent-7d'})
  assert.equal(result.mentionCount,14)
  assert.ok(result.uniqueAuthors>=10)
  assert.ok(result.momentumScore>=55)
  assert.ok(result.organicScore>=60)
  assert.notEqual(result.signal,'SHILL-HEAVY')
  assert.ok(result.largeAccountMentions>=1)
})

test('duplicate promo wave is labeled high shill risk',()=>{
  const posts=[]
  for(let i=0;i<10;i+=1){
    posts.push(post(
      i,
      '$SOMO StreamFomo 100x moonshot buy now dont miss',
      3+i,
      {followers:25,ageDays:10,engagement:1}
    ))
  }

  const result=analyzeXPosts(posts,identity)
  assert.ok(result.duplicateRatio>0.7)
  assert.ok(result.shillRiskScore>=70)
  assert.equal(result.shillRisk,'HIGH')
  assert.equal(result.signal,'SHILL-HEAVY')
})

test('short common ticker does not match unrelated bare-word chatter',()=>{
  const result=analyzeXPosts([
    post(1,'AI models are changing software development',5,{followers:5000}),
  ],{
    address:'',
    symbol:'AI',
    name:'',
  })

  assert.equal(result.mentionCount,0)
})
