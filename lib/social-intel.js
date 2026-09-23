const CACHE_TTL = 60_000
const cache = new Map()

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function finite(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function safeText(value, max = 1600) {
  return String(value || '').slice(0, max)
}

function cached(key) {
  const item = cache.get(key)
  return item && Date.now() - item.time < CACHE_TTL ? item.value : null
}

function put(key, value) {
  cache.set(key, { time: Date.now(), value })
  if (cache.size > 100) cache.delete(cache.keys().next().value)
}

function recencyWeight(timestamp) {
  const time = new Date(timestamp || 0).getTime()
  if (!Number.isFinite(time) || time <= 0) return 0.1
  const ageHours = Math.max(0, (Date.now() - time) / 3_600_000)
  if (ageHours <= 0.25) return 1
  if (ageHours <= 1) return 0.92
  if (ageHours <= 3) return 0.78
  if (ageHours <= 6) return 0.64
  if (ageHours <= 24) return 0.42
  if (ageHours <= 72) return 0.22
  return 0.1
}

export function normalizeTerms(input = {}) {
  const address = String(input.address || '').trim()
  const symbol = String(input.symbol || '').replace(/^\$/, '').trim()
  const name = String(input.name || '').trim()
  return { address, symbol, name }
}

function cleanQueryTerm(value) {
  return String(value || '').replaceAll('"', '').replace(/[\r\n]+/g, ' ').trim()
}

export function buildXQuery(input = {}) {
  const { address, symbol, name } = normalizeTerms(input)
  const parts = []

  if (address.length >= 32) parts.push(address)
  if (symbol.length >= 2) parts.push('$' + cleanQueryTerm(symbol))
  if (name.length >= 3) parts.push('"' + cleanQueryTerm(name) + '"')

  if (symbol.length >= 4) {
    const cleanSymbol = cleanQueryTerm(symbol)
    parts.push('(' + cleanSymbol + ' (solana OR pumpfun OR "pump.fun" OR memecoin OR crypto))')
  }

  const unique = [...new Set(parts.filter(Boolean))]
  if (!unique.length) return ''
  return '(' + unique.join(' OR ') + ') -is:retweet'
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^$()|[\]\\]/g, '\\$&')
}

function postRelevance(text, input = {}) {
  const body = String(text || '')
  const lower = body.toLowerCase()
  const { address, symbol, name } = normalizeTerms(input)
  let score = 0

  if (address && body.includes(address)) score += 1

  if (symbol) {
    const cash = new RegExp('\\$' + escapeRegex(symbol) + '\\b', 'i')
    if (cash.test(body)) score += 0.92

    const bare = new RegExp('\\b' + escapeRegex(symbol) + '\\b', 'i')
    const hasCryptoContext = /(solana|pump\.fun|pumpfun|memecoin|meme coin|crypto|token|market cap|\bmc\b|dex|ca:|contract)/i.test(body)
    if (bare.test(body) && (symbol.length >= 4 || hasCryptoContext)) score += symbol.length >= 4 ? 0.48 : 0.28
  }

  if (name && name.length >= 3 && lower.includes(name.toLowerCase())) score += 0.72
  return clamp(score, 0, 1)
}

function textFingerprint(text) {
  return safeText(text, 400)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\$[a-z0-9_]+/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 180)
}

function classifyText(text) {
  const t = String(text || '').toLowerCase()
  const positive = [
    'bullish','breakout','breaking out','accumulating','accumulation','bidding','bid is strong',
    'higher low','uptrend','momentum','send it','sending','runner','undervalued','community strong',
    'holding strong','new high','ath','volume coming in','buyers stepping in','cooking'
  ]
  const negative = [
    'bearish','dump','dumping','dead','selloff','selling off','exit liquidity','collapse',
    'jeet','dev sold','team sold','liquidity pulled','honeypot','scam','rug','rugged'
  ]
  const risk = [
    'rug','rugged','scam','honeypot','bundle','bundled','dev sold','team sold',
    'liquidity pulled','fake','impersonator','insider','sniper','wash trading','bot farm'
  ]
  const catalyst = [
    'stream','livestream','live stream','launch','listing','listed','partnership','announcement',
    'donation','airdrop','burn','cto','community takeover','spaces','space tonight','trending'
  ]
  const promo = [
    '100x','1000x','easy money','ape now','buy now','dont miss','don\'t miss','next gem',
    'moonshot','send this','raid','raid now','shill'
  ]

  let positiveHits = 0
  let negativeHits = 0
  for (const phrase of positive) if (t.includes(phrase)) positiveHits += 1
  for (const phrase of negative) if (t.includes(phrase)) negativeHits += 1

  const riskHits = risk.filter((phrase) => t.includes(phrase))
  const catalystHits = catalyst.filter((phrase) => t.includes(phrase))
  const promoHits = promo.filter((phrase) => t.includes(phrase))
  const raw = clamp(positiveHits - negativeHits, -4, 4)

  return {
    sentiment: raw / 4,
    riskHits,
    catalystHits,
    promoHits,
  }
}

function accountAgeDays(createdAt) {
  const time = new Date(createdAt || 0).getTime()
  if (!Number.isFinite(time) || time <= 0) return null
  return Math.max(0, (Date.now() - time) / 86_400_000)
}

function extractNarratives(posts, input) {
  const { address, symbol, name } = normalizeTerms(input)
  const excluded = new Set([
    'the','and','for','with','this','that','from','have','has','are','was','were','will','just',
    'coin','token','crypto','solana','pumpfun','pump','meme','memecoin','about','into','your',
    'you','they','their','our','out','new','now','not','but','can','its','it','all','get','got',
    'more','like','what','when','where','who','why','how','been','than','then','here','there',
    address.toLowerCase(),symbol.toLowerCase(),'$' + symbol.toLowerCase(),
    ...name.toLowerCase().split(/\s+/),
  ].filter(Boolean))

  const counts = new Map()
  for (const post of posts) {
    const weight = 1 + Math.min(4, Math.log10(1 + finite(post.engagement))) + recencyWeight(post.timestamp)
    const words = String(post.text || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9$]+/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 3 && word.length <= 24 && !excluded.has(word) && !/^\d+$/.test(word))

    const unique = [...new Set(words)]
    for (const word of unique) counts.set(word, (counts.get(word) || 0) + weight)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term, weight]) => ({ term, weight: Number(weight.toFixed(1)) }))
}

function countWithin(posts, ms) {
  const cutoff = Date.now() - ms
  return posts.filter((post) => {
    const time = new Date(post.timestamp || 0).getTime()
    return Number.isFinite(time) && time >= cutoff
  }).length
}

function labelSentiment(value) {
  if (value >= 0.3) return 'BULLISH'
  if (value >= 0.1) return 'POSITIVE'
  if (value <= -0.3) return 'BEARISH'
  if (value <= -0.1) return 'NEGATIVE'
  return 'NEUTRAL'
}

export function analyzeXPosts(posts = [], input = {}, meta = {}) {
  const relevant = posts
    .filter((post) => post && post.text)
    .map((post) => {
      const relevance = postRelevance(post.text, input)
      const language = String(post.language || '').toLowerCase()
      const classification = classifyText(post.text)
      return { ...post, relevance, language, classification }
    })
    .filter((post) => post.relevance >= 0.35)

  const fingerprints = new Map()
  const authorCounts = new Map()
  const uniqueAuthorMap = new Map()
  let weightedMentions = 0
  let weightedSentiment = 0
  let sentimentWeight = 0
  let engagement = 0
  let impressions = 0
  let verifiedMentions = 0
  let largeAccountMentions = 0
  let promoMentions = 0
  let lowFollowerMentions = 0
  let newAccountMentions = 0
  const riskClaims = new Map()
  const catalysts = new Map()

  for (const post of relevant) {
    const fp = textFingerprint(post.text)
    if (fp) fingerprints.set(fp, (fingerprints.get(fp) || 0) + 1)

    const authorKey = post.author?.id || post.author?.username || post.authorId || 'unknown'
    authorCounts.set(authorKey, (authorCounts.get(authorKey) || 0) + 1)
    if (authorKey !== 'unknown' && !uniqueAuthorMap.has(authorKey)) uniqueAuthorMap.set(authorKey, post.author || {})

    const recency = recencyWeight(post.timestamp)
    weightedMentions += recency * post.relevance

    const sentimentEligible = !post.language || post.language === 'en' || post.language === 'und'
    if (sentimentEligible) {
      const w = recency * post.relevance
      weightedSentiment += post.classification.sentiment * w
      sentimentWeight += w
    }

    engagement += finite(post.engagement)
    impressions += finite(post.impressions)

    if (post.author?.verified) verifiedMentions += 1
    if (finite(post.author?.followers) >= 10_000) largeAccountMentions += 1
    if (finite(post.author?.followers) < 100) lowFollowerMentions += 1

    const ageDays = accountAgeDays(post.author?.createdAt)
    if (ageDays !== null && ageDays < 90) newAccountMentions += 1

    if (post.classification.promoHits.length) promoMentions += 1
    for (const claim of post.classification.riskHits) riskClaims.set(claim, (riskClaims.get(claim) || 0) + 1)
    for (const catalyst of post.classification.catalystHits) catalysts.set(catalyst, (catalysts.get(catalyst) || 0) + 1)
  }

  const duplicatePosts = [...fingerprints.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
  const duplicateRatio = relevant.length ? duplicatePosts / relevant.length : 0
  const uniqueAuthors = uniqueAuthorMap.size || new Set(relevant.map((post) => post.authorId).filter(Boolean)).size
  const maxAuthorPosts = authorCounts.size ? Math.max(...authorCounts.values()) : 0
  const authorConcentration = relevant.length ? maxAuthorPosts / relevant.length : 0
  const lowFollowerShare = relevant.length ? lowFollowerMentions / relevant.length : 0
  const newAccountShare = relevant.length ? newAccountMentions / relevant.length : 0
  const promoShare = relevant.length ? promoMentions / relevant.length : 0

  const m15 = countWithin(relevant, 15 * 60_000)
  const h1 = countWithin(relevant, 60 * 60_000)
  const h3 = countWithin(relevant, 3 * 60 * 60_000)
  const h24 = countWithin(relevant, 24 * 60 * 60_000)
  const previousTwoHours = Math.max(0, h3 - h1)
  const priorHourlyRate = previousTwoHours / 2
  const accelerationRatio = priorHourlyRate > 0
    ? h1 / priorHourlyRate
    : h1 >= 3 ? 3 : h1 > 0 ? 1.5 : 0

  const sentiment = sentimentWeight ? weightedSentiment / sentimentWeight : 0
  const relevanceScore = relevant.length
    ? relevant.reduce((sum, post) => sum + post.relevance, 0) / relevant.length * 100
    : 0

  const shillRiskScore = Math.round(clamp(
    duplicateRatio * 38 +
    authorConcentration * 24 +
    lowFollowerShare * 14 +
    newAccountShare * 10 +
    promoShare * 20,
    0,
    100,
  ))

  const organicScore = Math.round(clamp(
    100 -
    shillRiskScore +
    Math.min(12, uniqueAuthors * 0.8) +
    Math.min(8, largeAccountMentions * 2),
    0,
    100,
  ))

  let momentumScore = 32
  if (relevant.length) {
    momentumScore += Math.min(20, Math.log10(1 + weightedMentions) * 13)
    momentumScore += Math.min(12, Math.log10(1 + engagement) * 3.2)
    momentumScore += Math.min(10, Math.log10(1 + uniqueAuthors) * 5)
    momentumScore += Math.min(12, Math.max(0, accelerationRatio - 1) * 7)
    momentumScore += sentiment * 9
    momentumScore += Math.min(6, largeAccountMentions * 1.5)
    momentumScore -= duplicateRatio * 15
  }
  momentumScore = Math.round(clamp(momentumScore, 0, 100))

  const qualityScore = Math.round(clamp(
    relevanceScore * 0.36 +
    organicScore * 0.30 +
    Math.min(18, uniqueAuthors * 1.3) +
    Math.min(10, largeAccountMentions * 2) +
    Math.min(8, verifiedMentions * 1.5),
    0,
    100,
  ))

  let signal = 'QUIET'
  if (relevant.length) {
    if (shillRiskScore >= 72) signal = 'SHILL-HEAVY'
    else if (sentiment <= -0.22 && h1 >= 2) signal = 'NEGATIVE PRESSURE'
    else if (momentumScore >= 75 && accelerationRatio >= 1.35) signal = 'IGNITING'
    else if (momentumScore >= 60) signal = 'BUILDING'
    else signal = 'MIXED'
  }

  const topPosts = [...relevant]
    .map((post) => {
      const followers = finite(post.author?.followers)
      const impactScore =
        post.relevance * 26 +
        recencyWeight(post.timestamp) * 18 +
        Math.min(24, Math.log10(1 + finite(post.engagement)) * 8) +
        Math.min(20, Math.log10(1 + followers) * 4) +
        (post.author?.verified ? 7 : 0)
      return { ...post, impactScore: Number(impactScore.toFixed(1)) }
    })
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 10)
    .map((post) => ({
      id: post.id,
      text: safeText(post.text, 420),
      timestamp: post.timestamp || null,
      url: post.url || null,
      language: post.language || null,
      engagement: finite(post.engagement),
      impressions: finite(post.impressions),
      impactScore: post.impactScore,
      author: post.author ? {
        id: post.author.id || null,
        username: post.author.username || null,
        name: post.author.name || null,
        verified: Boolean(post.author.verified),
        verifiedType: post.author.verifiedType || null,
        followers: finite(post.author.followers),
        createdAt: post.author.createdAt || null,
      } : null,
    }))

  const latestAt = relevant
    .map((post) => post.timestamp)
    .filter(Boolean)
    .sort()
    .at(-1) || null

  return {
    source: 'x',
    available: true,
    searchMode: meta.searchMode || 'recent-7d',
    query: meta.query || buildXQuery(input),
    queryTerms: normalizeTerms(input),
    requestedResults: finite(meta.requestedResults, 100),
    rawResultCount: finite(meta.rawResultCount, posts.length),
    mentionCount: relevant.length,
    weightedMentions: Number(weightedMentions.toFixed(2)),
    uniqueAuthors,
    engagement,
    impressions,
    sentiment: Number(sentiment.toFixed(3)),
    sentimentLabel: labelSentiment(sentiment),
    relevanceScore: Math.round(relevanceScore),
    duplicateRatio: Number(duplicateRatio.toFixed(3)),
    authorConcentration: Number(authorConcentration.toFixed(3)),
    verifiedMentions,
    largeAccountMentions,
    lowFollowerShare: Number(lowFollowerShare.toFixed(3)),
    newAccountShare: Number(newAccountShare.toFixed(3)),
    promoShare: Number(promoShare.toFixed(3)),
    shillRiskScore,
    shillRisk: shillRiskScore >= 70 ? 'HIGH' : shillRiskScore >= 40 ? 'MODERATE' : 'LOW',
    organicScore,
    momentumScore,
    qualityScore,
    accelerationRatio: Number(accelerationRatio.toFixed(2)),
    signal,
    windows: { m15, h1, h3, h24 },
    latestAt,
    narratives: extractNarratives(relevant, input),
    riskClaims: [...riskClaims.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([term, count]) => ({ term, count })),
    catalysts: [...catalysts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([term, count]) => ({ term, count })),
    posts: topPosts,
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(6500) })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }

  if (!response.ok) {
    const detail = data?.detail || data?.title || data?.error || data?.raw || ''
    throw new Error('X HTTP ' + response.status + (detail ? ': ' + String(detail).slice(0, 180) : ''))
  }
  return data
}

function normalizeXResponse(data) {
  const users = new Map(
    (data?.includes?.users || []).map((user) => [
      user.id,
      {
        id: user.id,
        username: user.username || null,
        name: user.name || null,
        verified: Boolean(user.verified || user.is_identity_verified),
        verifiedType: user.verified_type || null,
        followers: finite(user?.public_metrics?.followers_count),
        following: finite(user?.public_metrics?.following_count),
        postCount: finite(user?.public_metrics?.tweet_count || user?.public_metrics?.post_count),
        createdAt: user.created_at || null,
      },
    ]),
  )

  return (data?.data || []).map((post) => {
    const metrics = post?.public_metrics || {}
    const author = users.get(post.author_id) || { id: post.author_id || null }
    const engagement =
      finite(metrics.like_count) +
      finite(metrics.reply_count) * 2 +
      finite(metrics.retweet_count || metrics.repost_count) * 2 +
      finite(metrics.quote_count) * 2 +
      finite(metrics.bookmark_count)

    return {
      id: post.id,
      text: post.text || '',
      authorId: post.author_id || null,
      author,
      engagement,
      impressions: finite(metrics.impression_count),
      timestamp: post.created_at || null,
      language: post.lang || null,
      url: post.id
        ? 'https://x.com/' + (author.username || 'i/web') + '/status/' + post.id
        : null,
    }
  })
}

export async function scanX(input = {}) {
  const token = process.env.X_BEARER_TOKEN
  if (!token) {
    return {
      source: 'x',
      available: false,
      reason: 'X API credentials not configured',
      connectionRequired: 'X_BEARER_TOKEN',
      searchMode: 'recent-7d',
    }
  }

  const query = buildXQuery(input)
  if (!query) return { source: 'x', available: false, reason: 'No usable X search terms' }

  const archiveEnabled = process.env.X_FULL_ARCHIVE_ENABLED === '1'
  const endpoint = archiveEnabled
    ? 'https://api.x.com/2/tweets/search/all'
    : 'https://api.x.com/2/tweets/search/recent'

  const pages = clamp(Math.round(finite(process.env.X_SEARCH_PAGES, 1)), 1, 3)
  const maxResults = 100
  const posts = []
  let nextToken = ''
  let rawResultCount = 0

  try {
    for (let page = 0; page < pages; page += 1) {
      const params = new URLSearchParams({
        query,
        max_results: String(maxResults),
        sort_order: 'recency',
        'tweet.fields': 'created_at,public_metrics,author_id,text,lang,possibly_sensitive',
        expansions: 'author_id',
        'user.fields': 'id,name,username,verified,verified_type,is_identity_verified,public_metrics,created_at',
      })
      if (nextToken) params.set('next_token', nextToken)

      const data = await fetchJson(endpoint + '?' + params.toString(), {
        headers: { Authorization: 'Bearer ' + token },
      })

      const batch = normalizeXResponse(data)
      posts.push(...batch)
      rawResultCount += finite(data?.meta?.result_count, batch.length)
      nextToken = String(data?.meta?.next_token || '')
      if (!nextToken || batch.length === 0) break
    }

    const deduped = [...new Map(posts.map((post) => [post.id, post])).values()]
    return analyzeXPosts(deduped, input, {
      query,
      searchMode: archiveEnabled ? 'full-archive' : 'recent-7d',
      requestedResults: maxResults * pages,
      rawResultCount,
    })
  } catch (error) {
    return {
      source: 'x',
      available: false,
      reason: error?.message || 'X request failed',
      searchMode: archiveEnabled ? 'full-archive' : 'recent-7d',
      query,
    }
  }
}

function unavailableSocial(x) {
  return {
    available: false,
    hasMentions: false,
    providerCoverage: 0,
    sourceDiversity: 0,
    mentionCount: 0,
    weightedMentions: 0,
    uniqueAuthors: 0,
    engagement: 0,
    sentiment: 0,
    relevanceScore: 0,
    duplicateRatio: 0,
    authorConcentration: 0,
    momentumScore: 0,
    qualityScore: 0,
    organicScore: 0,
    shillRiskScore: 0,
    signal: 'OFFLINE',
    x,
    providers: [x],
  }
}

export async function getSocialIntel(input = {}) {
  const terms = normalizeTerms(input)
  const key = JSON.stringify(terms)
  const hit = cached(key)
  if (hit) return hit

  const x = await scanX(input)
  if (!x.available) {
    const value = unavailableSocial(x)
    put(key, value)
    return value
  }

  const value = {
    available: true,
    hasMentions: x.mentionCount > 0,
    providerCoverage: 1,
    sourceDiversity: 1,
    mentionCount: x.mentionCount,
    weightedMentions: x.weightedMentions,
    uniqueAuthors: x.uniqueAuthors,
    engagement: x.engagement,
    impressions: x.impressions,
    sentiment: x.sentiment,
    relevanceScore: x.relevanceScore,
    duplicateRatio: x.duplicateRatio,
    authorConcentration: x.authorConcentration,
    momentumScore: x.momentumScore,
    qualityScore: x.qualityScore,
    organicScore: x.organicScore,
    shillRiskScore: x.shillRiskScore,
    shillRisk: x.shillRisk,
    accelerationRatio: x.accelerationRatio,
    signal: x.signal,
    verifiedMentions: x.verifiedMentions,
    largeAccountMentions: x.largeAccountMentions,
    searchMode: x.searchMode,
    windows: x.windows,
    narratives: x.narratives,
    riskClaims: x.riskClaims,
    catalysts: x.catalysts,
    latestAt: x.latestAt,
    posts: x.posts,
    x,
    providers: [x],
  }

  put(key, value)
  return value
}
