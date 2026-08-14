import { createPublicClient, fallback, http, isAddress, type Address } from "viem"
import { base } from "viem/chains"
import type { LinkedWallet } from "@/lib/accounts"
import { getAccountWallets } from "@/lib/accounts"
import {
  PAPPARDELLE_BASE_TOKEN,
  PAPPARDELLE_EVM_TESTER_MINIMUM,
  PAPPARDELLE_TOKEN_BASE_UNITS,
  qualifiesForEvmTesterTier,
} from "@/lib/pappardelle-tester-policy"

const ERC20_BALANCE_ABI = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const

export type EvmTesterEntitlement = {
  eligible: boolean
  tier: "evm-tester" | null
  tokenSymbol: "pappardelle"
  tokenAddress: string
  minimumUiAmount: number
  balanceUiAmount: number
  walletAddress: string | null
  status: "eligible" | "ineligible" | "unavailable"
  checkedAt: string
}

type CacheEntry = { expiresAt: number; value: EvmTesterEntitlement }
const globalCache = globalThis as typeof globalThis & { __dappsterPappardelleEntitlements?: Map<string, CacheEntry> }

function entitlementCache() {
  globalCache.__dappsterPappardelleEntitlements ||= new Map()
  return globalCache.__dappsterPappardelleEntitlements
}

function baseClient() {
  const rpcUrls = Array.from(new Set([
    process.env.BASE_RPC_URL,
    "https://base-rpc.publicnode.com",
    "https://base.drpc.org",
    "https://mainnet.base.org",
  ].filter((url): url is string => Boolean(url))))
  return createPublicClient({ chain: base, transport: fallback(rpcUrls.map(url => http(url))) })
}

export async function getEvmTesterEntitlementForWallets(wallets: Pick<LinkedWallet, "chain" | "wallet_address">[]): Promise<EvmTesterEntitlement> {
  const evmWallets = Array.from(new Set(wallets
    .filter(wallet => wallet.chain === "evm" && isAddress(wallet.wallet_address))
    .map(wallet => wallet.wallet_address.toLowerCase())))
    .sort()
  const cacheKey = evmWallets.join(":") || "no-evm-wallet"
  const cached = entitlementCache().get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const checkedAt = new Date().toISOString()
  let value: EvmTesterEntitlement
  if (!evmWallets.length) {
    value = { eligible: false, tier: null, tokenSymbol: "pappardelle", tokenAddress: PAPPARDELLE_BASE_TOKEN, minimumUiAmount: PAPPARDELLE_EVM_TESTER_MINIMUM, balanceUiAmount: 0, walletAddress: null, status: "ineligible", checkedAt }
  } else {
    const client = baseClient()
    const balances = await Promise.allSettled(evmWallets.map(async walletAddress => ({
      walletAddress,
      balanceRaw: await client.readContract({ address: PAPPARDELLE_BASE_TOKEN as Address, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [walletAddress as Address] }),
    })))
    const successful = balances.flatMap(result => result.status === "fulfilled" ? [result.value] : [])
    const highest = successful.reduce<{ walletAddress: string; balanceRaw: bigint } | null>((current, candidate) => !current || candidate.balanceRaw > current.balanceRaw ? candidate : current, null)
    const eligible = Boolean(highest && qualifiesForEvmTesterTier(highest.balanceRaw))
    const unavailable = !eligible && balances.some(result => result.status === "rejected")
    value = {
      eligible,
      tier: eligible ? "evm-tester" : null,
      tokenSymbol: "pappardelle",
      tokenAddress: PAPPARDELLE_BASE_TOKEN,
      minimumUiAmount: PAPPARDELLE_EVM_TESTER_MINIMUM,
      balanceUiAmount: highest ? Number(highest.balanceRaw / PAPPARDELLE_TOKEN_BASE_UNITS) : 0,
      walletAddress: highest?.walletAddress || null,
      status: eligible ? "eligible" : unavailable ? "unavailable" : "ineligible",
      checkedAt,
    }
    if (unavailable) console.warn("[pappardelle-tester-tier] one or more linked EVM wallets could not be checked")
  }

  const cache = entitlementCache()
  if (cache.size > 1_000) cache.clear()
  cache.set(cacheKey, { expiresAt: Date.now() + (value.status === "unavailable" ? 10_000 : 60_000), value })
  return value
}

export async function getEvmTesterEntitlement(accountId: string) {
  return getEvmTesterEntitlementForWallets(await getAccountWallets(accountId))
}
