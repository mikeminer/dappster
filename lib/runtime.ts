import { getAuthenticatedUser } from "./supabase"
import { resolveAccountId } from "./accounts"

export type RequestUser = { id: string; authId: string; token: string; isDemo: boolean }

export function hasSupabaseConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  )
}

export async function getRequestUser(request: Request): Promise<RequestUser> {
  if (hasSupabaseConfig()) {
    const user = await getAuthenticatedUser(request)
    const accountId = await resolveAccountId(user.id)
    return { id: accountId, authId: user.id, token: user.token, isDemo: false }
  }

  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    throw new Error("Dappster authentication is not configured")
  }

  return {
    id: "00000000-0000-0000-0000-000000000001",
    authId: "00000000-0000-0000-0000-000000000001",
    token: "",
    isDemo: true,
  }
}

export async function getOptionalRequestUser(request: Request): Promise<RequestUser | null> {
  if (!hasSupabaseConfig()) return getRequestUser(request)
  if (!request.headers.get("authorization")) return null
  try {
    return await getRequestUser(request)
  } catch {
    return null
  }
}
