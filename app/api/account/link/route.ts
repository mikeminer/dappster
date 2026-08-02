import { NextResponse } from "next/server"
import { z } from "zod"
import { getRequestUser } from "@/lib/runtime"
import { getAuthenticatedUserFromToken, supabaseRequest } from "@/lib/supabase"
import { getAccountWallets } from "@/lib/accounts"

const schema = z.object({ primaryAccessToken: z.string().min(20) })

export async function POST(request: Request) {
  try {
    const current = await getRequestUser(request)
    if (current.isDemo) throw new Error("Account linking requires Supabase authentication")
    const input = schema.parse(await request.json())
    const primary = await getAuthenticatedUserFromToken(input.primaryAccessToken)

    const result = await supabaseRequest<Array<{ account_id: string }>>({
      path: "rpc/link_wallet_accounts",
      method: "POST",
      body: { p_primary_auth_user: primary.id, p_secondary_auth_user: current.authId },
    })
    const accountId = result[0]?.account_id || current.id
    return NextResponse.json({ ok: true, accountId, wallets: await getAccountWallets(accountId) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not link wallets" }, { status: 400 })
  }
}
