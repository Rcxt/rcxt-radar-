const CACHE_TTL = 60_000
const cache = new Map()
let redditTokenCache = { token: null, expiresAt: 0 }

function cached(key) {
  const item = cache.get(key)
  return item && Date.now() - item.time < CACHE_TTL ? item.value : null
}

function put(key, value) {
  cache.set(key, { time: Date.now(), value })
  if (cache.size > 150) cache.delete(cache.keys().next().value)
}

function safeText(value, max = 1200) {
  return String(value || '').slice(0, max)
}

function recencyWeight(timestamp) {
  const time = new Date(timestamp || 0).getTime()
  if (!Number.isFinite(time) || time <= 0) return 0.15
  const ageH = Math.max(0, (Date.now() - time) / 3_600_000)
  if (ageH <= 1) return 1
  if (ageH <= 6) return 0.82
  if (ageH <= 24) return 0.55
  if (ageH <= 72) return 0.25
  return 0.1
}

function normalizeTerms({ address, symbol, name }) {
  const cleanSymbol = String(symbol || '').replace(/^\$/, '').trim()
  const terms = [address, cleanSymbol && '$' + cleanSymbol, cleanSymbol, name].filter(Boolean)
  return [...new Set(terms.map((x) => String(x).trim()).filter((x) => x.length >= 2))].slice(0, 4)
}

function queryString(terms) {
  return terms.map((term) => {
    const clean = String(term).replaceAll('"', '')
    return /\s/.test(clean) ? `"${clean}"` : clean
  }).join(' OR ')
}

function textFingerprint(text) {
  return safeText(text, 260)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 150)
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function postRelevance(text, input) {
  const body = String(text || '')
  const lower = body.toLowerCase()
  const address = String(input?.address || '').trim()
  const symbol = String(input?.symbol || '').replace(/^\$/, '').trim()
  const name = String(input?.name || '').trim()

  let score = 0
  if (address && body.includes(address)) score += 1
  if (symbol) {
    const cash = new RegExp(`\\$${escapeRegex(symbol)}\\b`, 'i')
    if (cash.test(body)) score += 0.85
    if (symbol.length >= 4) {
      const bare = new RegExp(`\\b${escapeRegex(symbol)}\\b`, 'i')
      if (bare.test(body)) score += 0.45
    }
  }
  if (name && name.length >= 4 && lower.includes(name.toLowerCase())) score += 0.65
  return Math.min(1, score)
}

function sentiment(text) {
  const t = String(text || '').toLowerCase()
  const positive = ['bullish', 'breakout', 'accumulating', 'strong', 'uptrend', 'higher low', 'momentum']
  const negative = ['rug', 'scam', 'dump', 'dead', 'bearish', 'warning', 'honeypot', 'exit liquidity', 'collapse']
  let score = 0
  for (const word of positive) if (t.includes(word)) score += 1
  for (const word of negative) if (t.includes(word)) score -= 1
  return Math.max(-3, Math.min(3, score))
}

function summarizePosts(source, posts, input) {
  const relevant = (posts || [])
    .filter((post) => post && post.text)
    .map((post) => ({ ...post, relevance: postRelevance(post.text, input) }))
    .filter((post) => post.relevance >= 0.35)

  const fingerprints = new Map()
  const authorCounts = new Map()

  for (const post of relevant) {
    const fp = textFingerprint(post.text)
    if (fp) fingerprints.set(fp, (fingerprints.get(fp) || 0) + 1)
    if (post.author) authorCounts.set(post.author, (authorCounts.get(post.author) || 0) + 1)
  }

  const duplicatePosts = [...fingerprints.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
  const duplicateRatio = relevant.length ? duplicatePosts / relevant.length : 0
  const uniqueAuthors = authorCounts.size
  const maxAuthorPosts = authorCounts.size ? Math.max(...authorCounts.values()) : 0
  const authorConcentration = relevant.length && maxAuthorPosts ? maxAuthorPosts / relevant.length : 0
  const totalEngagement = relevant.reduce((sum, post) => sum + Number(post.engagement || 0), 0)
  const weightedMentions = relevant.reduce(
    (sum, post) => sum + recencyWeight(post.timestamp) * post.relevance,
    0,
  )
  const sentimentSum = relevant.reduce((sum, post) => sum + sentiment(post.text) * post.relevance, 0)
  const relevanceTotal = relevant.reduce((sum, post) => sum + post.relevance, 0)
  const sentimentScore = relevanceTotal ? sentimentSum / (relevanceTotal * 3) : 0
  const relevanceScore = relevant.length
    ? (relevanceTotal / relevant.length) * 100
    : 0

  return {
    source,
    available: true,
    mentionCount: relevant.length,
    weightedMentions: Number(weightedMentions.toFixed(2)),
    uniqueAuthors,
    engagement: totalEngagement,
    sentiment: Number(sentimentScore.toFixed(3)),
    duplicateRatio: Number(duplicateRatio.toFixed(3)),
    authorConcentration: Number(authorConcentration.toFixed(3)),
    relevanceScore: Math.round(relevanceScore),
    latestAt: relevant.map((post) => post.timestamp).filter(Boolean).sort().at(-1) || null,
    posts: relevant.slice(0, 8),
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(4500) })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }

  if (!response.ok) {
    const detail =
      data?.error?.message ||
      data?.detail ||
      data?.title ||
      data?.raw ||
      ''
    throw new Error(`HTTP ${response.status}${detail ? `: ${String(detail).slice(0, 180)}` : ''}`)
  }

  return data
}

async function getRedditToken() {
  if (process.env.REDDIT_BEARER_TOKEN) return process.env.REDDIT_BEARER_TOKEN

  const clientId = process.env.REDDIT_CLIENT_ID
  const clientSecret = process.env.REDDIT_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  if (redditTokenCache.token && Date.now() < redditTokenCache.expiresAt) {
    return redditTokenCache.token
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const userAgent =
    process.env.REDDIT_USER_AGENT ||
    'web:rcxt-radar:v3.0.0 (by /u/rcxt-radar)'
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': userAgent,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(4500),
  })
  if (!response.ok) throw new Error(`Reddit OAuth HTTP ${response.status}`)
  const data = await response.json()
  if (!data?.access_token) throw new Error('Reddit OAuth returned no token')

  redditTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 90) * 1000,
  }
  return redditTokenCache.token
}

export async function scanReddit(input) {
  let token
  try {
    token = await getRedditToken()
  } catch (error) {
    return { source: 'reddit', available: false, reason: error?.message || 'Reddit OAuth failed' }
  }
  if (!token) {
    return {
      source: 'reddit',
      available: false,
      reason: 'Reddit API credentials not configured',
    }
  }

  const terms = normalizeTerms(input)
  if (!terms.length) return { source: 'reddit', available: false, reason: 'No search terms' }

  try {
    const q = encodeURIComponent(queryString(terms))
    const userAgent =
      process.env.REDDIT_USER_AGENT ||
      'web:rcxt-radar:v3.0.0 (by /u/rcxt-radar)'
    const data = await fetchJson(
      `https://oauth.reddit.com/search?q=${q}&sort=new&t=day&limit=50&raw_json=1`,
      { headers: { Authorization: `Bearer ${token}`, 'User-Agent': userAgent } },
    )
    const posts = (data?.data?.children || []).map(({ data: post }) => ({
      id: post?.id,
      text: `${post?.title || ''}\n${post?.selftext || ''}`,
      author: post?.author || null,
      engagement: Number(post?.score || 0) + Number(post?.num_comments || 0) * 2,
      timestamp: post?.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
      url: post?.permalink ? `https://www.reddit.com${post.permalink}` : null,
    }))
    return summarizePosts('reddit', posts, input)
  } catch (error) {
    return { source: 'reddit', available: false, reason: error?.message || 'Reddit request failed' }
  }
}

export async function scanX(input) {
  const token = process.env.X_BEARER_TOKEN
  if (!token) return { source: 'x', available: false, reason: 'X API credentials not configured' }

  const terms = normalizeTerms(input)
  if (!terms.length) return { source: 'x', available: false, reason: 'No search terms' }

  try {
    const q = encodeURIComponent(`(${queryString(terms)}) -is:retweet lang:en`)
    const data = await fetchJson(
      `https://api.x.com/2/tweets/search/recent?query=${q}&max_results=50&tweet.fields=created_at,public_metrics,author_id,text`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const posts = (data?.data || []).map((post) => ({
      id: post?.id,
      text: post?.text || '',
      author: post?.author_id || null,
      engagement:
        Number(post?.public_metrics?.like_count || 0) +
        Number(post?.public_metrics?.reply_count || 0) * 2 +
        Number(post?.public_metrics?.retweet_count || 0) * 2,
      timestamp: post?.created_at || null,
      url: post?.id ? `https://x.com/i/web/status/${post.id}` : null,
    }))
    return summarizePosts('x', posts, input)
  } catch (error) {
    return { source: 'x', available: false, reason: error?.message || 'X request failed' }
  }
}

export async function scanInstagram(input) {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN
  const userId = process.env.INSTAGRAM_USER_ID
  const graphVersion = process.env.META_GRAPH_VERSION || 'v24.0'

  if (!accessToken || !userId) {
    return {
      source: 'instagram',
      available: false,
      reason: 'Instagram Graph credentials not configured',
    }
  }

  const term = String(input.symbol || input.name || '')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 60)
  if (!term) return { source: 'instagram', available: false, reason: 'No hashtag-compatible search term' }

  try {
    let search
    try {
      search = await fetchJson(
        `https://graph.facebook.com/${graphVersion}/ig_hashtag_search?user_id=${encodeURIComponent(userId)}&q=${encodeURIComponent(term)}&access_token=${encodeURIComponent(accessToken)}`,
      )
    } catch (legacyError) {
      search = await fetchJson(
        `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(userId)}/hashtag_search?q=${encodeURIComponent(term)}&access_token=${encodeURIComponent(accessToken)}`,
      )
    }
    const hashtagId = search?.data?.[0]?.id
    if (!hashtagId) return summarizePosts('instagram', [], input)

    const data = await fetchJson(
      `https://graph.facebook.com/${graphVersion}/${hashtagId}/recent_media?user_id=${encodeURIComponent(userId)}&fields=id,caption,comments_count,like_count,permalink,timestamp&limit=50&access_token=${encodeURIComponent(accessToken)}`,
    )
    const posts = (data?.data || []).map((post) => ({
      id: post?.id,
      text: post?.caption || '',
      author: null,
      engagement: Number(post?.like_count || 0) + Number(post?.comments_count || 0) * 2,
      timestamp: post?.timestamp || null,
      url: post?.permalink || null,
    }))
    return summarizePosts('instagram', posts, input)
  } catch (error) {
    return { source: 'instagram', available: false, reason: error?.message || 'Instagram request failed' }
  }
}

export function aggregateSocial(results) {
  const configured = (results || []).filter((result) => result?.available)
  const active = configured.filter((result) => Number(result.mentionCount || 0) > 0)

  const mentions = active.reduce((sum, result) => sum + result.mentionCount, 0)
  const weightedMentions = active.reduce((sum, result) => sum + result.weightedMentions, 0)
  const engagement = active.reduce((sum, result) => sum + result.engagement, 0)
  const uniqueAuthors = active.reduce((sum, result) => sum + result.uniqueAuthors, 0)

  const weightedByMentions = (field) => {
    if (!mentions) return 0
    return active.reduce(
      (sum, result) => sum + Number(result[field] || 0) * Number(result.mentionCount || 0),
      0,
    ) / mentions
  }

  const duplicateRatio = weightedByMentions('duplicateRatio')
  const authorConcentration = weightedByMentions('authorConcentration')
  const sentimentScore = weightedByMentions('sentiment')
  const relevanceScore = weightedByMentions('relevanceScore')
  const sourceDiversity = active.length
  const providerCoverage = configured.length

  let momentum = 50
  if (mentions) {
    momentum += Math.min(16, Math.log10(1 + weightedMentions) * 9)
    momentum += Math.min(8, Math.log10(1 + engagement) * 2.8)
    momentum += Math.min(8, Math.log10(1 + uniqueAuthors) * 3.8)
    momentum += sentimentScore * 10
    momentum += (relevanceScore - 60) * 0.12
    momentum -= duplicateRatio * 24
    momentum -= authorConcentration * 14
    if (sourceDiversity >= 2) momentum += 5
  }

  const quality = Math.round(Math.max(0, Math.min(
    100,
    providerCoverage * 12 +
    sourceDiversity * 12 +
    Math.min(22, uniqueAuthors * 2) +
    relevanceScore * 0.28 -
    duplicateRatio * 30 -
    authorConcentration * 20,
  )))

  return {
    available: providerCoverage > 0,
    hasMentions: mentions > 0,
    providerCoverage,
    sourceDiversity,
    mentionCount: mentions,
    weightedMentions: Number(weightedMentions.toFixed(2)),
    uniqueAuthors,
    engagement,
    sentiment: Number(sentimentScore.toFixed(3)),
    relevanceScore: Math.round(relevanceScore),
    duplicateRatio: Number(duplicateRatio.toFixed(3)),
    authorConcentration: Number(authorConcentration.toFixed(3)),
    momentumScore: Math.round(Math.max(0, Math.min(100, momentum))),
    qualityScore: quality,
    providers: results,
  }
}

export async function getSocialIntel(input) {
  const key = JSON.stringify(normalizeTerms(input))
  const hit = cached(key)
  if (hit) return hit

  const results = await Promise.all([
    scanReddit(input),
    scanX(input),
    scanInstagram(input),
  ])
  const value = aggregateSocial(results)
  put(key, value)
  return value
}
