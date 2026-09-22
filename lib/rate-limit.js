const windows = new Map()

export function rateLimit(req, { key = 'default', limit = 60, windowMs = 60_000 } = {}) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  const ip = forwarded || String(req.headers?.['x-real-ip'] || 'unknown')
  const id = `${key}:${ip}`
  const now = Date.now()
  let state = windows.get(id)

  if (!state || now >= state.resetAt) {
    state = { count: 0, resetAt: now + windowMs }
  }

  state.count += 1
  windows.set(id, state)

  if (windows.size > 2000) {
    for (const [entryKey, entry] of windows) {
      if (now >= entry.resetAt) windows.delete(entryKey)
      if (windows.size <= 1500) break
    }
  }

  return {
    allowed: state.count <= limit,
    remaining: Math.max(0, limit - state.count),
    resetAt: state.resetAt,
  }
}

export function applyRateHeaders(res, result, limit) {
  res.setHeader('X-RateLimit-Limit', String(limit))
  res.setHeader('X-RateLimit-Remaining', String(result.remaining))
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)))
}
