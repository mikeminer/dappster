import { getBrowserSupabase } from "@/lib/supabase-browser"

const DEMO_USER_KEY = "dappster-demo-user"
const WALLET_SESSION_KEY = "dappster-wallet-session"

export type LocalWalletSession = { chain: "evm" | "solana"; address: string }

export function getLocalWalletSession(): LocalWalletSession | null {
  if (typeof window === "undefined") return null
  try {
    const session = JSON.parse(localStorage.getItem(WALLET_SESSION_KEY) || "null") as LocalWalletSession | null
    return session?.address && (session.chain === "evm" || session.chain === "solana") ? session : null
  } catch {
    return null
  }
}

export function setLocalWalletSession(session: LocalWalletSession) {
  localStorage.setItem(WALLET_SESSION_KEY, JSON.stringify(session))
  localStorage.setItem(DEMO_USER_KEY, `${session.chain}:${session.address}`)
  window.dispatchEvent(new Event("dappster-auth-change"))
}

export function clearLocalWalletSession() {
  localStorage.removeItem(WALLET_SESSION_KEY)
  localStorage.removeItem(DEMO_USER_KEY)
  localStorage.removeItem("dappster-projects")
  localStorage.removeItem("dappster-pending-generation")
  window.dispatchEvent(new Event("dappster-auth-change"))
}

export async function getAccessToken() {
  const supabase = getBrowserSupabase()
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || null
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken()
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  const responseText = await response.text()
  let payload: T & { error?: string }
  try {
    payload = (responseText ? JSON.parse(responseText) : {}) as T & { error?: string }
  } catch {
    if (response.ok) throw new Error("Dappster returned an invalid server response. Please try again.")
    const timedOut = response.status === 504 || /(?:timed? out|an error occurred)/i.test(responseText)
    payload = {
      error: timedOut
        ? "The deployment worker timed out. Your recorded payment is safe; retry without sending SOL again."
        : responseText.trim().slice(0, 500) || `Request failed (${response.status})`,
    } as T & { error?: string }
  }
  if (!response.ok) {
    const message = payload.error || `Request failed (${response.status})`
    if (typeof window !== "undefined" && /(?:insufficient|not enough) credits|you need \d+ credits?|crediti insufficienti/i.test(message)) {
      window.dispatchEvent(new CustomEvent("dappster:credits-required", { detail: { message } }))
    }
    throw new Error(message)
  }
  return payload
}
