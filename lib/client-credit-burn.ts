"use client"

import { createPublicClient, http, type Hash } from "viem"
import { base } from "viem/chains"
import { apiFetch } from "@/lib/client-api"
import { getConnectedEvmWallet } from "@/lib/connected-evm-wallet"
import { BASE_MEMBERSHIP_CONTRACT, MEMBERSHIP_ABI } from "@/lib/payments"

export type CreditBurnProof = {
  txHash: Hash
  usageId: Hash
  payer: `0x${string}`
  storageKey?: string
}

type BurnIntent = { skipBurn: boolean; usageId?: Hash }
type Workspace = { wallets?: Array<{ wallet_address: string; chain: "evm" | "solana" }> }

export async function burnCreditsFromUserWallet(amount: number, action: string): Promise<CreditBurnProof | null> {
  const storageKey = `dappster-credit-burn:${amount}:${action}`
  try {
    const pending = JSON.parse(sessionStorage.getItem(storageKey) || "null") as CreditBurnProof | null
    if (pending?.txHash && pending.usageId && pending.payer) return { ...pending, storageKey }
  } catch {
    sessionStorage.removeItem(storageKey)
  }
  const intent = await apiFetch<BurnIntent>("/api/credits/intent", {
    method: "POST",
    body: JSON.stringify({ amount, action }),
  })
  if (intent.skipBurn) return null
  if (!intent.usageId) throw new Error("Dappster could not create a credit burn authorization")
  if (!BASE_MEMBERSHIP_CONTRACT) throw new Error("The Base membership contract is not configured")

  const { address: payer, wallet } = await getConnectedEvmWallet(base)
  const workspace = await apiFetch<Workspace>("/api/me")
  if (!workspace.wallets?.some(linked => linked.chain === "evm" && linked.wallet_address.toLowerCase() === payer.toLowerCase())) {
    throw new Error("Use the EVM wallet linked to this Dappster account to burn credits")
  }

  const publicClient = createPublicClient({ chain: base, transport: http() })
  const balance = await publicClient.readContract({
    address: BASE_MEMBERSHIP_CONTRACT,
    abi: MEMBERSHIP_ABI,
    functionName: "balanceOf",
    args: [payer, BigInt(1)],
  })
  if (balance < BigInt(amount)) throw new Error(`Your linked EVM wallet needs ${amount} on-chain Dappster Credits for this action`)

  const txHash = await wallet.writeContract({
    account: payer,
    address: BASE_MEMBERSHIP_CONTRACT,
    abi: MEMBERSHIP_ABI,
    functionName: "burnOwnCredits",
    args: [BigInt(amount), intent.usageId],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 })
  if (receipt.status !== "success") throw new Error("The credit burn transaction did not succeed")
  const proof = { txHash, usageId: intent.usageId, payer, storageKey }
  sessionStorage.setItem(storageKey, JSON.stringify(proof))
  return proof
}

export function clearPendingCreditBurn(proof: CreditBurnProof | null) {
  if (proof?.storageKey) sessionStorage.removeItem(proof.storageKey)
}
