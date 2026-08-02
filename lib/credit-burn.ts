import { z } from "zod"
import { createPublicClient, decodeEventLog, fallback, http, isAddress } from "viem"
import { base } from "viem/chains"
import { accountHasWallet } from "./accounts"
import { BASE_MEMBERSHIP_CONTRACT, MEMBERSHIP_ABI } from "./payments"
import { supabaseRequest } from "./supabase"

export const creditBurnProofSchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  usageId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  payer: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
})

export type CreditBurnProofInput = z.infer<typeof creditBurnProofSchema>

type BurnSpendRow = {
  user_id: string
  amount: number
  type: string
  description: string
}

async function recoverIdempotentBurnSpend(userId: string, amount: number, description: string, burnId: string) {
  const existing = await supabaseRequest<BurnSpendRow[]>({
    path: "credit_transactions",
    query: { payment_id: `eq.${burnId}`, select: "user_id,amount,type,description", limit: "1" },
  })
  const row = existing[0]
  if (!row || row.user_id !== userId || row.amount !== -amount || row.type !== "spend" || row.description !== description) {
    throw new Error("This on-chain credit burn is already linked to a different action")
  }
  const profiles = await supabaseRequest<{ credits: number }[]>({
    path: "profiles",
    query: { id: `eq.${userId}`, select: "credits", limit: "1" },
  })
  if (!profiles[0]) throw new Error("The synchronized credit balance could not be loaded")
  return profiles[0].credits
}

export async function verifyAndSpendCreditBurn(userId: string, amount: number, description: string, proof: CreditBurnProofInput | undefined) {
  if (!proof) throw new Error(`Confirm the ${amount}-credit burn from your linked EVM wallet before this action`)
  if (!BASE_MEMBERSHIP_CONTRACT || !isAddress(BASE_MEMBERSHIP_CONTRACT)) throw new Error("The Base membership contract is not configured")
  const membershipContract = BASE_MEMBERSHIP_CONTRACT
  if (!await accountHasWallet(userId, "evm", proof.payer)) throw new Error("The wallet that burned credits is not linked to this Dappster account")

  const client = createPublicClient({
    chain: base,
    transport: fallback([http(process.env.BASE_RPC_URL), http("https://base.drpc.org"), http("https://mainnet.base.org")]),
  })
  const receipt = await client.getTransactionReceipt({ hash: proof.txHash as `0x${string}` })
  if (receipt.status !== "success") throw new Error("The Base credit burn transaction did not succeed")
  if (receipt.from.toLowerCase() !== proof.payer.toLowerCase()) throw new Error("The linked wallet did not submit this credit burn")
  if (receipt.to?.toLowerCase() !== membershipContract.toLowerCase()) throw new Error("Credits were not burned through the Dappster contract")

  const validBurn = receipt.logs
    .filter(log => log.address.toLowerCase() === membershipContract.toLowerCase())
    .some(log => {
      try {
        const decoded = decodeEventLog({ abi: MEMBERSHIP_ABI, eventName: "CreditsConsumed", data: log.data, topics: log.topics })
        return decoded.args.account.toLowerCase() === proof.payer.toLowerCase()
          && decoded.args.credits === BigInt(amount)
          && decoded.args.usageId.toLowerCase() === proof.usageId.toLowerCase()
      } catch { return false }
    })
  if (!validBurn) throw new Error(`The transaction did not burn exactly ${amount} Dappster Credits for this action`)

  const burnId = `base-burn:${proof.txHash.toLowerCase()}:${proof.usageId.toLowerCase()}`
  let result: { credits_remaining: number }[]
  try {
    result = await supabaseRequest<{ credits_remaining: number }[]>({
      path: "rpc/spend_burned_credits",
      method: "POST",
      body: { p_user_id: userId, p_amount: amount, p_description: description, p_burn_id: burnId },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (!message.includes("This on-chain credit burn has already been used")) throw error
    return recoverIdempotentBurnSpend(userId, amount, description, burnId)
  }
  if (!result?.[0]) throw new Error("The on-chain credit burn could not be synchronized")
  return result[0].credits_remaining
}
