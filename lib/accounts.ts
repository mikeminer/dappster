import { supabaseRequest } from "./supabase"

export type LinkedWallet = {
  auth_user_id: string
  account_id: string
  wallet_address: string
  chain: "evm" | "solana"
  created_at?: string
}

export function normalizeWalletAddress(chain: "evm" | "solana", address: string) {
  const trimmed = address.trim()
  return chain === "evm"
    ? trimmed.replace(/^web3:ethereum:/i, "")
    : trimmed.replace(/^web3:solana:/i, "")
}

export async function resolveAccountId(authUserId: string) {
  const rows = await supabaseRequest<Array<{ account_id: string }>>({
    path: "account_wallets",
    query: { auth_user_id: `eq.${authUserId}`, select: "account_id", limit: "1" },
  })
  return rows[0]?.account_id || authUserId
}

export async function getAccountWallets(accountId: string) {
  const wallets = await supabaseRequest<LinkedWallet[]>({
    path: "account_wallets",
    query: { account_id: `eq.${accountId}`, select: "auth_user_id,account_id,wallet_address,chain,created_at", order: "created_at.asc" },
  })
  return wallets.map(wallet => ({
    ...wallet,
    wallet_address: normalizeWalletAddress(wallet.chain, wallet.wallet_address),
  }))
}

export async function accountHasWallet(accountId: string, chain: "evm" | "solana", address: string) {
  const wallets = await getAccountWallets(accountId)
  const expected = normalizeWalletAddress(chain, address)
  return wallets.some(wallet => {
    if (wallet.chain !== chain) return false
    const linked = normalizeWalletAddress(chain, wallet.wallet_address)
    return chain === "evm" ? linked.toLowerCase() === expected.toLowerCase() : linked === expected
  })
}
