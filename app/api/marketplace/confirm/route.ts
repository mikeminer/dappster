import { NextResponse } from "next/server"
import { z } from "zod"
import { createPublicClient, decodeEventLog, http, isAddress } from "viem"
import { base } from "viem/chains"
import { Connection, PublicKey, type ParsedInstruction, type PartiallyDecodedInstruction } from "@solana/web3.js"
import { getAssociatedTokenAddressSync } from "@solana/spl-token"
import { getRequestUser } from "@/lib/runtime"
import { platformRecipient, splitUsdc, type AssetVisibility } from "@/lib/marketplace"
import { supabaseRequest } from "@/lib/supabase"
import { USDC_ABI, USDC_BASE_ADDRESS, USDC_DECIMALS, USDC_SOLANA_MINT } from "@/lib/payments"

const baseInput = z.object({ network: z.literal("base"), dappId: z.string().uuid(), asset: z.enum(["source", "frontend", "audit", "deploy"]), payer: z.string(), creatorTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), platformTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) })
const solanaInput = z.object({ network: z.literal("solana"), dappId: z.string().uuid(), asset: z.enum(["source", "frontend", "audit", "deploy"]), payer: z.string(), signature: z.string().min(40).max(120) })
const schema = z.discriminatedUnion("network", [baseInput, solanaInput])

async function verifyBaseTransfer(hash: `0x${string}`, payer: string, recipient: string, amount: bigint) {
  const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) })
  const receipt = await client.getTransactionReceipt({ hash })
  if (receipt.status !== "success" || receipt.from.toLowerCase() !== payer.toLowerCase()) throw new Error("A Base payment transaction is invalid")
  const valid = receipt.logs.filter(log => log.address.toLowerCase() === USDC_BASE_ADDRESS.toLowerCase()).some(log => {
    try {
      const decoded = decodeEventLog({ abi: USDC_ABI, eventName: "Transfer", data: log.data, topics: log.topics })
      return decoded.args.from.toLowerCase() === payer.toLowerCase() && decoded.args.to.toLowerCase() === recipient.toLowerCase() && decoded.args.value === amount
    } catch { return false }
  })
  if (!valid) throw new Error(`The Base transaction did not transfer the expected USDC amount to ${recipient}`)
}

async function verifySolanaTransfer(signature: string, payerAddress: string, creator: string, creatorMicros: bigint, platformMicros: bigint) {
  const connection = new Connection(process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed")
  const transaction = await connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
  if (!transaction || transaction.meta?.err) throw new Error("The Solana payment was not found or failed")
  const payer = new PublicKey(payerAddress)
  if (!transaction.transaction.message.accountKeys.some(key => key.signer && key.pubkey.equals(payer))) throw new Error("The authenticated wallet did not sign this payment")
  const mint = new PublicKey(USDC_SOLANA_MINT)
  const creatorAta = getAssociatedTokenAddressSync(mint, new PublicKey(creator)).toBase58()
  const platformAta = getAssociatedTokenAddressSync(mint, new PublicKey(platformRecipient("solana"))).toBase58()
  const instructions: Array<ParsedInstruction | PartiallyDecodedInstruction> = [...transaction.transaction.message.instructions, ...(transaction.meta?.innerInstructions?.flatMap(group => group.instructions) || [])]
  const hasTransfer = (destination: string, amount: bigint) => instructions.some(instruction => {
    if (!("parsed" in instruction) || instruction.program !== "spl-token" || instruction.parsed?.type !== "transferChecked") return false
    const info = instruction.parsed.info as { destination?: string; authority?: string; mint?: string; tokenAmount?: { amount?: string } }
    return info.destination === destination && info.authority === payerAddress && info.mint === USDC_SOLANA_MINT && info.tokenAmount?.amount === amount.toString()
  })
  if (!hasTransfer(creatorAta, creatorMicros) || !hasTransfer(platformAta, platformMicros)) throw new Error("The Solana transaction does not contain the required creator and platform payments")
}

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = schema.parse(await request.json())
    const existing = await supabaseRequest<{ id: string }[]>({ path: "marketplace_purchases", query: { buyer_id: `eq.${user.id}`, dapp_id: `eq.${input.dappId}`, asset_type: `eq.${input.asset}`, select: "id", limit: "1" } })
    if (existing[0]) return NextResponse.json({ ok: true, alreadyPurchased: true })
    const dapps = await supabaseRequest<Array<Record<string, unknown> & { owner_id: string; base_payout_address?: string; solana_payout_address?: string }>>({ path: "dapps", query: { id: `eq.${input.dappId}`, is_listed: "eq.true", select: "id,owner_id,source_visibility,frontend_visibility,audit_visibility,deploy_visibility,source_price_usdc,frontend_price_usdc,audit_price_usdc,deploy_price_usdc,base_payout_address,solana_payout_address", limit: "1" } })
    const dapp = dapps[0]
    if (!dapp || dapp[`${input.asset}_visibility`] as AssetVisibility !== "paid") throw new Error("This content is not available for purchase")
    const profiles = await supabaseRequest<{ id: string; wallet_address: string; chain: "evm" | "solana" }[]>({ path: "profiles", query: { id: `in.(${user.id},${dapp.owner_id})`, select: "id,wallet_address,chain" } })
    const buyer = profiles.find(profile => profile.id === user.id)
    const creator = profiles.find(profile => profile.id === dapp.owner_id)
    if (!buyer || !creator || buyer.wallet_address.toLowerCase() !== input.payer.toLowerCase()) throw new Error("Payment wallet does not match the authenticated account")
    const expectedNetwork = buyer.chain === "solana" ? "solana" : "base"
    if (input.network !== expectedNetwork) throw new Error("Payment network does not match the buyer wallet")
    const creatorAddress = input.network === "base" ? dapp.base_payout_address || (creator.chain === "evm" ? creator.wallet_address : "") : dapp.solana_payout_address || (creator.chain === "solana" ? creator.wallet_address : "")
    if (!creatorAddress) throw new Error("The creator payout address is not configured for this network")
    const amount = Number(dapp[`${input.asset}_price_usdc`])
    const split = splitUsdc(amount)
    let reference: string
    if (input.network === "base") {
      if (!isAddress(input.payer) || !isAddress(creatorAddress)) throw new Error("Invalid Base payment address")
      await verifyBaseTransfer(input.creatorTxHash as `0x${string}`, input.payer, creatorAddress, split.creatorMicros)
      await verifyBaseTransfer(input.platformTxHash as `0x${string}`, input.payer, platformRecipient("base"), split.platformMicros)
      reference = `base:${input.creatorTxHash.toLowerCase()}:${input.platformTxHash.toLowerCase()}`
    } else {
      await verifySolanaTransfer(input.signature, input.payer, creatorAddress, split.creatorMicros, split.platformMicros)
      reference = `solana:${input.signature}`
    }
    await supabaseRequest({ path: "marketplace_purchases", method: "POST", body: { buyer_id: user.id, dapp_id: input.dappId, asset_type: input.asset, network: input.network, payer_address: input.payer, creator_address: creatorAddress, amount_usdc: amount, creator_amount_usdc: split.creatorAmount, platform_amount_usdc: split.platformAmount, payment_reference: reference } })
    return NextResponse.json({ ok: true, asset: input.asset, amount, creatorAmount: split.creatorAmount, platformAmount: split.platformAmount })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not verify marketplace payment" }, { status: 400 })
  }
}
