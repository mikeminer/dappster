import { NextResponse } from "next/server"
import { z } from "zod"
import { getAuthenticatedUser, supabaseRequest } from "@/lib/supabase"

const schema = z.object({
  chain: z.enum(["evm", "solana"]),
  address: z.string().trim().min(1).max(100),
})

type WalletChain = "evm" | "solana"

function normalizeAddress(chain: WalletChain, value: string) {
  const stripped = value.trim().replace(/^web3:(ethereum|solana):/i, "")
  return chain === "evm" ? stripped.toLowerCase() : stripped
}

function inferChain(value: string): WalletChain | null {
  if (/^web3:ethereum:/i.test(value) || /^0x[0-9a-f]{40}$/i.test(value)) return "evm"
  if (/^web3:solana:/i.test(value) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return "solana"
  return null
}

function verifiedWalletIdentities(user: Awaited<ReturnType<typeof getAuthenticatedUser>>) {
  const identities: Array<{ chain: WalletChain; address: string }> = []
  for (const identity of user.identities || []) {
    const data = identity.identity_data || {}
    const candidates = [identity.provider_id, data.sub, data.address, data.wallet_address]
    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue
      const chain = inferChain(candidate)
      if (!chain) continue
      identities.push({ chain, address: normalizeAddress(chain, candidate) })
    }
  }
  return identities
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request)
    const input = schema.parse(await request.json())
    const address = normalizeAddress(input.chain, input.address)

    if (input.chain === "evm" && !/^0x[0-9a-f]{40}$/.test(address)) throw new Error("Invalid EVM wallet address")
    if (input.chain === "solana" && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) throw new Error("Invalid Solana wallet address")

    const verified = verifiedWalletIdentities(user)
    if (!verified.some(identity => identity.chain === input.chain && identity.address === address)) {
      throw new Error("The wallet identity in this Supabase session does not match the connected wallet")
    }

    const rows = await supabaseRequest<Array<{ account_id: string }>>({
      path: "rpc/bootstrap_web3_identity",
      method: "POST",
      body: { p_auth_user_id: user.id, p_wallet_address: address, p_chain: input.chain },
    })
    return NextResponse.json({ ok: true, accountId: rows[0]?.account_id || user.id })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not verify wallet identity" }, { status: 400 })
  }
}
