import { supabaseRequest } from "./supabase"

export const CREDIT_COSTS = { generate: 5, audit_basic: 15, audit_premium: 25, deploy: 2 } as const

export async function getCredits(userId: string) {
  const rows = await supabaseRequest<{ credits: number; plan: string; plan_expires_at: string | null }[]>({ path: "profiles", query: { id: `eq.${userId}`, select: "credits,plan,plan_expires_at", limit: "1" } })
  if (!rows[0]) throw new Error("Profile not found")
  return rows[0]
}

export function hasActivePro(profile: { plan: string; plan_expires_at?: string | null }) {
  return profile.plan === "pro" && Boolean(profile.plan_expires_at) && new Date(profile.plan_expires_at!).getTime() > Date.now()
}

export async function assertCredits(userId: string, amount: number) {
  const profile = await getCredits(userId)
  if (!hasActivePro(profile) && profile.credits < amount) throw new Error(`You need ${amount} credits for this action`)
  return profile
}

export async function deductCredits(userId: string, amount: number, description: string) {
  const result = await supabaseRequest<{ credits_remaining: number }[]>({
    path: "rpc/spend_credits",
    method: "POST",
    body: { p_user_id: userId, p_amount: amount, p_description: description },
  })
  if (!result?.[0]) throw new Error("Credit transaction failed")
  return result[0].credits_remaining
}
