type SupabaseRequest = { path: string; method?: string; token?: string; body?: unknown; query?: Record<string, string> }

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !publishable) throw new Error("Supabase is not configured")
  return { url, publishable, secret }
}

export function getSupabaseAdminConfig() {
  const { url, secret } = env()
  if (!secret) throw new Error("Supabase service role is not configured")
  return { url, secret }
}

export async function supabaseRequest<T>({ path, method = "GET", token, body, query }: SupabaseRequest): Promise<T> {
  const { url, publishable, secret } = env()
  const endpoint = new URL(`${url}/rest/v1/${path}`)
  Object.entries(query || {}).forEach(([key, value]) => endpoint.searchParams.set(key, value))
  const key = token ? publishable : (secret || publishable)
  const authorization = token || (!key.startsWith("sb_secret_") ? key : null)
  const response = await fetch(endpoint, {
    method,
    headers: {
      apikey: key,
      ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "return=minimal",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  })
  if (!response.ok) throw new Error((await response.text()) || "Database request failed")
  const text = await response.text()
  return (text ? JSON.parse(text) : null) as T
}

export async function getAuthenticatedUser(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  if (!token) throw new Error("Authentication required")
  return getAuthenticatedUserFromToken(token)
}

export async function getAuthenticatedUserFromToken(token: string) {
  const { url, publishable } = env()
  const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: publishable, Authorization: `Bearer ${token}` }, cache: "no-store" })
  if (!response.ok) throw new Error("Invalid or expired session")
  const user = await response.json() as {
    id: string
    user_metadata?: Record<string, unknown>
    identities?: Array<{
      provider?: string
      provider_id?: string
      identity_data?: Record<string, unknown>
    }>
  }
  return { ...user, token }
}
