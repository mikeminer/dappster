import type { LinkedWallet } from "@/lib/accounts"
import { getAccountWallets } from "@/lib/accounts"
import { PASTA_SOLANA_TESTER_MINIMUM, PASTA_TOKEN_BASE_UNITS, PASTA_TOKEN_MINT, qualifiesForSolanaTesterTier } from "@/lib/pasta-developer-policy"

export type SolanaTesterEntitlement = {
  eligible: boolean
  tier: "solana-tester" | null
  tokenSymbol: "PASTA"
  mint: string
  minimumUiAmount: number
  balanceUiAmount: number
  walletAddress: string | null
  status: "eligible" | "ineligible" | "unavailable"
  checkedAt: string
}

type ParsedTokenAccountResponse = {
  error?: { code?: number; message?: string }
  result?: { value?: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }> }
}

type CacheEntry = { expiresAt: number; value: SolanaTesterEntitlement }
const globalCache = globalThis as typeof globalThis & { __dappsterPastaEntitlements?: Map<string, CacheEntry> }

function entitlementCache() {
  globalCache.__dappsterPastaEntitlements ||= new Map()
  return globalCache.__dappsterPastaEntitlements
}

function mainnetRpcUrls() {
  return Array.from(new Set([
    process.env.SOLANA_MAINNET_RPC_URL,
    process.env.SOLANA_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    "https://api.mainnet-beta.solana.com",
  ].filter((url): url is string => Boolean(url) && !url!.toLowerCase().includes("devnet"))))
}

async function readPastaBalance(walletAddress: string) {
  const errors: string[] = []
  for (const rpcUrl of mainnetRpcUrls()) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `dappster-pasta-${walletAddress}`,
          method: "getTokenAccountsByOwner",
          params: [walletAddress, { mint: PASTA_TOKEN_MINT }, { encoding: "jsonParsed", commitment: "confirmed" }],
        }),
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as ParsedTokenAccountResponse
      if (payload.error) throw new Error(payload.error.message || `RPC ${payload.error.code || "error"}`)
      return (payload.result?.value || []).reduce((total, tokenAccount) => {
        const amount = tokenAccount.account?.data?.parsed?.info?.tokenAmount?.amount
        return total + (amount && /^\d+$/.test(amount) ? BigInt(amount) : BigInt(0))
      }, BigInt(0))
    } catch (error) {
      errors.push(`${rpcUrl}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`PASTA balance lookup failed (${errors.join("; ")})`)
}

export async function getSolanaTesterEntitlementForWallets(wallets: Pick<LinkedWallet, "chain" | "wallet_address">[]): Promise<SolanaTesterEntitlement> {
  const solanaWallets = Array.from(new Set(wallets
    .filter(wallet => wallet.chain === "solana")
    .map(wallet => wallet.wallet_address.trim())
    .filter(Boolean)))
    .sort()
  const cacheKey = solanaWallets.join(":") || "no-solana-wallet"
  const cached = entitlementCache().get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const checkedAt = new Date().toISOString()
  let value: SolanaTesterEntitlement
  if (!solanaWallets.length) {
    value = { eligible: false, tier: null, tokenSymbol: "PASTA", mint: PASTA_TOKEN_MINT, minimumUiAmount: PASTA_SOLANA_TESTER_MINIMUM, balanceUiAmount: 0, walletAddress: null, status: "ineligible", checkedAt }
  } else {
    const results = await Promise.allSettled(solanaWallets.map(async walletAddress => ({ walletAddress, balanceRaw: await readPastaBalance(walletAddress) })))
    const balances = results.flatMap(result => result.status === "fulfilled" ? [result.value] : [])
    const highest = balances.reduce<{ walletAddress: string; balanceRaw: bigint } | null>((current, candidate) => !current || candidate.balanceRaw > current.balanceRaw ? candidate : current, null)
    const eligible = Boolean(highest && qualifiesForSolanaTesterTier(highest.balanceRaw))
    const unavailable = !eligible && results.some(result => result.status === "rejected")
    value = {
      eligible,
      tier: eligible ? "solana-tester" : null,
      tokenSymbol: "PASTA",
      mint: PASTA_TOKEN_MINT,
      minimumUiAmount: PASTA_SOLANA_TESTER_MINIMUM,
      balanceUiAmount: highest ? Number(highest.balanceRaw / PASTA_TOKEN_BASE_UNITS) : 0,
      walletAddress: highest?.walletAddress || null,
      status: eligible ? "eligible" : unavailable ? "unavailable" : "ineligible",
      checkedAt,
    }
    if (unavailable) console.warn("[solana-tester-tier] one or more linked Solana wallets could not be checked")
  }

  const cache = entitlementCache()
  if (cache.size > 1_000) cache.clear()
  cache.set(cacheKey, { expiresAt: Date.now() + (value.status === "unavailable" ? 10_000 : 60_000), value })
  return value
}

export async function getSolanaTesterEntitlement(accountId: string) {
  return getSolanaTesterEntitlementForWallets(await getAccountWallets(accountId))
}
