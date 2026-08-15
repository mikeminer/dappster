import { supabaseRequest } from "./supabase"

const windows = new Map<string, number[]>()

function enforceLocalRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const active = (windows.get(key) || []).filter(timestamp => timestamp > now - windowMs)
  if (active.length >= limit) throw new Error("Rate limit reached. Try again later.")
  active.push(now)
  windows.set(key, active)
}

export async function enforceRateLimit(key: string, limit = 10, windowMs = 60 * 60 * 1000) {
  try {
    const rows = await supabaseRequest<Array<{ allowed: boolean; retry_after_seconds: number }>>({
      path: "rpc/consume_rate_limit",
      method: "POST",
      body: {
        p_key: key,
        p_limit: limit,
        p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
      },
    })
    if (!rows?.[0]?.allowed) {
      const retry = Math.max(1, rows?.[0]?.retry_after_seconds || Math.ceil(windowMs / 1000))
      throw new Error(`Rate limit reached. Try again in ${retry} seconds.`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.includes("Rate limit reached")) throw error
    const migrationPending = /Supabase is not configured|PGRST202|consume_rate_limit|schema cache/i.test(message)
    if (migrationPending) {
      // Local/demo development remains usable before the additive database
      // migration is installed. Production uses the atomic Postgres bucket.
      enforceLocalRateLimit(key, limit, windowMs)
      return
    }
    throw new Error("Rate limit service is temporarily unavailable. Try again shortly.")
  }
}
