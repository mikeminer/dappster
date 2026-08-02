import { NextResponse } from "next/server"
import { z } from "zod"
import { getRequestUser } from "@/lib/runtime"
import { accountHasWallet, getAccountWallets } from "@/lib/accounts"

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (user.isDemo) return NextResponse.json({ accountId: user.id, wallets: [] })
    return NextResponse.json({ accountId: user.id, wallets: await getAccountWallets(user.id) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load linked wallets" }, { status: 401 })
  }
}

const walletCheckSchema = z.object({
  chain: z.enum(["evm", "solana"]),
  address: z.string().trim().min(1).max(100),
})

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = walletCheckSchema.parse(await request.json())
    if (user.isDemo) return NextResponse.json({ linked: true })
    return NextResponse.json({ linked: await accountHasWallet(user.id, input.chain, input.address) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not verify linked wallet" }, { status: 400 })
  }
}
