import { NextResponse } from "next/server"
import { z } from "zod"
import { getRequestUser } from "@/lib/runtime"
import { localListDapps, localProfile, localSetUsername } from "@/lib/local-store"
import { supabaseRequest } from "@/lib/supabase"
import { getAccountWallets } from "@/lib/accounts"
import { countDappsterPoints } from "@/lib/dappster-points"
import { getSolanaTesterEntitlementForWallets } from "@/lib/pasta-developer-tier"
import { getEvmTesterEntitlementForWallets } from "@/lib/pappardelle-tester-tier"

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (user.isDemo) {
      const dapps = localListDapps({ ownerId: user.id })
      return NextResponse.json({ profile: { id: user.id, ...localProfile(user.id), chain: "evm", dappsterPoints: countDappsterPoints(dapps) }, dapps, mode: "local" })
    }
    const walletsPromise = getAccountWallets(user.id)
    const solanaTesterPromise = walletsPromise.then(getSolanaTesterEntitlementForWallets)
    const evmTesterPromise = walletsPromise.then(getEvmTesterEntitlementForWallets)
    const [profiles, dapps, wallets, creditTransactions, solanaTester, evmTester] = await Promise.all([
      supabaseRequest<unknown[]>({ path: "profiles", query: { id: `eq.${user.id}`, select: "id,wallet_address,chain,username,credits,plan,plan_expires_at,created_at", limit: "1" } }),
      supabaseRequest<unknown[]>({ path: "dapps", query: { owner_id: `eq.${user.id}`, select: "id,name,description,chain,contract_address,contract_tx_hash,contract_chain_id,contract_network,ipfs_hash,ipfs_url,deploy_status,is_listed,is_featured,tags,audit_status,created_at,updated_at", order: "updated_at.desc" } }),
      walletsPromise,
      supabaseRequest<unknown[]>({ path: "credit_transactions", query: { user_id: `eq.${user.id}`, select: "id,amount,type,description,created_at", order: "created_at.desc", limit: "100" } }),
      solanaTesterPromise,
      evmTesterPromise,
    ])
    const ownedIds = (dapps as Array<{ id: string }>).map(dapp => dapp.id)
    const sales = ownedIds.length ? await supabaseRequest<{ creator_amount_usdc: number | string }[]>({ path: "marketplace_purchases", query: { dapp_id: `in.(${ownedIds.join(",")})`, select: "creator_amount_usdc" } }) : []
    const creatorRevenueUsdc = sales.reduce((total, sale) => total + Number(sale.creator_amount_usdc), 0)
    return NextResponse.json({ profile: { ...(profiles[0] as Record<string, unknown>), dappsterPoints: countDappsterPoints(dapps as Array<Record<string, unknown>>) }, testerTiers: { solana: solanaTester, evm: evmTester }, wallets, dapps, creditTransactions, marketplace: { sales: sales.length, creatorRevenueUsdc }, mode: "supabase" })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load workspace" }, { status: 401 })
  }
}

const updateProfileSchema = z.object({
  username: z.string().trim().min(3, "Username must contain at least 3 characters").max(24, "Username cannot exceed 24 characters").regex(/^[A-Za-z0-9_]+$/, "Use only letters, numbers, and underscores"),
})

export async function PATCH(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = updateProfileSchema.parse(await request.json())
    if (user.isDemo) {
      localSetUsername(user.id, input.username)
      return NextResponse.json({ username: input.username })
    }
    await supabaseRequest({ path: "profiles", method: "PATCH", query: { id: `eq.${user.id}` }, body: { username: input.username } })
    return NextResponse.json({ username: input.username })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update username"
    return NextResponse.json({ error: message.includes("duplicate key") ? "That username is already taken" : message }, { status: 400 })
  }
}
