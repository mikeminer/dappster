import { NextResponse } from "next/server"
import { z } from "zod"
import { keccak256, stringToHex } from "viem"
import { getCredits, hasActivePro } from "@/lib/credits"
import { getRequestUser } from "@/lib/runtime"
import { getSolanaTesterEntitlement } from "@/lib/pasta-developer-tier"
import { isSolanaTesterAction } from "@/lib/pasta-developer-policy"
import { getEvmTesterEntitlement } from "@/lib/pappardelle-tester-tier"
import { isEvmTesterAction } from "@/lib/pappardelle-tester-policy"

const schema = z.object({
  amount: z.union([z.literal(2), z.literal(5), z.literal(15), z.literal(25)]),
  action: z.string().min(3).max(80),
})

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = schema.parse(await request.json())
    if (user.isDemo) return NextResponse.json({ skipBurn: true, mode: "local" })
    const profile = await getCredits(user.id)
    if (hasActivePro(profile)) return NextResponse.json({ skipBurn: true, mode: "pro" })
    const [solanaTester, evmTester] = await Promise.all([
      isSolanaTesterAction(input.action) ? getSolanaTesterEntitlement(user.id) : null,
      isEvmTesterAction(input.action) ? getEvmTesterEntitlement(user.id) : null,
    ])
    if (solanaTester?.eligible) return NextResponse.json({ skipBurn: true, mode: "solana-tester" })
    if (evmTester?.eligible) return NextResponse.json({ skipBurn: true, mode: "evm-tester" })
    if (profile.credits < input.amount) throw new Error(`You need ${input.amount} credits for this action`)
    const usageId = keccak256(stringToHex(`${user.id}:${input.action}:${input.amount}:${crypto.randomUUID()}`))
    return NextResponse.json({ skipBurn: false, usageId, mode: "onchain" })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare the credit burn"
    return NextResponse.json({ error: message }, { status: message.includes("credits") ? 402 : 400 })
  }
}
