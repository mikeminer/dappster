import { NextResponse } from "next/server"
import { z } from "zod"
import { createPublicClient, decodeEventLog, fallback, http, isAddress, parseUnits } from "viem"
import { base } from "viem/chains"
import { getRequestUser } from "@/lib/runtime"
import { localApplyPayment } from "@/lib/local-store"
import {
  BASE_MEMBERSHIP_CONTRACT,
  MEMBERSHIP_ABI,
  packageContractId,
  packages,
  USDC_ABI,
  USDC_BASE_ADDRESS,
  USDC_DECIMALS,
} from "@/lib/payments"
import { supabaseRequest } from "@/lib/supabase"
import { accountHasWallet } from "@/lib/accounts"

const packageId = z.enum(["starter", "builder", "pro", "unlimited"])
const schema = z.object({ network: z.literal("base"), packageId, txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), payer: z.string().regex(/^0x[0-9a-fA-F]{40}$/) })

type PaymentInput = z.infer<typeof schema>

async function verifyBase(input: PaymentInput) {
  const selected = packages[input.packageId]
  if (!BASE_MEMBERSHIP_CONTRACT || !isAddress(BASE_MEMBERSHIP_CONTRACT)) throw new Error("Base membership contract is not configured")
  const membershipContract = BASE_MEMBERSHIP_CONTRACT
  const client = createPublicClient({
    chain: base,
    transport: fallback([
      http(process.env.BASE_RPC_URL),
      http("https://base-rpc.publicnode.com"),
      http("https://base.drpc.org"),
    ]),
  })
  const receipt = await client.getTransactionReceipt({ hash: input.txHash as `0x${string}` })
  if (receipt.status !== "success") throw new Error("The Base transaction did not succeed")
  if (receipt.from.toLowerCase() !== input.payer.toLowerCase()) throw new Error("The connected wallet did not send this transaction")
  if (receipt.to?.toLowerCase() !== membershipContract.toLowerCase()) throw new Error("Payment was not executed through the Dappster membership contract on Base")

  const expectedAmount = parseUnits(String(selected.amount), USDC_DECIMALS)
  const validTransfer = receipt.logs
    .filter(log => log.address.toLowerCase() === USDC_BASE_ADDRESS.toLowerCase())
    .some(log => {
      try {
        const decoded = decodeEventLog({ abi: USDC_ABI, eventName: "Transfer", data: log.data, topics: log.topics })
        return decoded.args.from.toLowerCase() === input.payer.toLowerCase()
          && decoded.args.to.toLowerCase() === "0x5d69c42a3a481d0ccfd88cfa8a2a08e2bf456134"
          && decoded.args.value === expectedAmount
      } catch { return false }
    })
  if (!validTransfer) throw new Error(`Expected exactly ${selected.amount} USDC sent by the membership contract to the Dappster owner on Base`)

  const expectedPackageId = packageContractId(input.packageId)
  const validPurchaseEvent = receipt.logs
    .filter(log => log.address.toLowerCase() === membershipContract.toLowerCase())
    .some(log => {
      try {
        const decoded = decodeEventLog({ abi: MEMBERSHIP_ABI, data: log.data, topics: log.topics })
        if (expectedPackageId === null && decoded.eventName === "MembershipPurchased") {
          const args = decoded.args as { buyer: string; usdcPaid: bigint }
          return args.buyer.toLowerCase() === input.payer.toLowerCase() && args.usdcPaid === expectedAmount
        }
        if (expectedPackageId !== null && decoded.eventName === "CreditsPurchased") {
          const args = decoded.args as { buyer: string; packageId: bigint; credits: bigint; usdcPaid: bigint }
          return args.buyer.toLowerCase() === input.payer.toLowerCase()
            && args.packageId === expectedPackageId
            && args.credits === BigInt(selected.credits)
            && args.usdcPaid === expectedAmount
        }
        return false
      } catch { return false }
    })
  if (!validPurchaseEvent) throw new Error("The Base transaction did not mint the expected Dappster membership or credits")
  return { paymentId: `base:${input.txHash.toLowerCase()}`, reference: input.txHash }
}

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = schema.parse(await request.json())
    const selected = packages[input.packageId]
    const verified = await verifyBase(input)

    if (user.isDemo) {
      const profile = localApplyPayment(user.id, verified.paymentId, selected)
      return NextResponse.json({ ok: true, reference: verified.reference, profile, mode: "local" })
    }

    const walletMatches = await accountHasWallet(user.id, "evm", input.payer)
    if (!walletMatches) {
      throw new Error("Payment wallet does not match the authenticated Dappster account")
    }

    const description = `${selected.label} · USDC on Base`
    if (selected.plan) {
      await supabaseRequest({ path: "rpc/activate_plan", method: "POST", body: { p_user_id: user.id, p_plan: selected.plan, p_description: description, p_payment_id: verified.paymentId } })
    } else {
      await supabaseRequest({ path: "rpc/add_credits", method: "POST", body: { p_user_id: user.id, p_amount: selected.credits, p_description: description, p_payment_id: verified.paymentId } })
    }
    const updated = await supabaseRequest<unknown[]>({ path: "profiles", query: { id: `eq.${user.id}`, select: "credits,plan,plan_expires_at", limit: "1" } })
    return NextResponse.json({ ok: true, reference: verified.reference, profile: updated[0], mode: "supabase" })
  } catch (error) {
    console.error("[payments/confirm] verification failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not verify USDC payment" }, { status: 400 })
  }
}
