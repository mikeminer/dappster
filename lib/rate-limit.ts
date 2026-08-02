const windows = new Map<string, number[]>()

export function enforceRateLimit(key: string, limit = 10, windowMs = 60 * 60 * 1000) {
  const now = Date.now()
  const active = (windows.get(key) || []).filter(timestamp => timestamp > now - windowMs)
  if (active.length >= limit) throw new Error("Rate limit reached. Try again later.")
  active.push(now)
  windows.set(key, active)
}
