import { NextResponse } from "next/server"
import { z } from "zod"
import { getRequestUser } from "@/lib/runtime"
import { splitUsdc, platformRecipient, type AssetVisibility, type MarketplaceAsset } from "@/lib/marketplace"
import { supabaseRequest } from "@/lib/supabase"

const schema = z.object({ dappId: z.string().uuid(), asset: z.enum(["source", "frontend", "audit", "deploy"]) })

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = schema.parse(await request.json())
    const dapps = await supabaseRequest<Array<Record<string, unknown> & { owner_id: string; name: string; base_payout_address?: string; solana_payout_address?: string }>>({ path: "dapps", query: { id: `eq.${input.dappId}`, is_listed: "eq.true", select: "id,owner_id,name,source_visibility,frontend_visibility,audit_visibility,deploy_visibility,source_price_usdc,frontend_price_usdc,audit_price_usdc,deploy_price_usdc,base_payout_address,solana_payout_address", limit: "1" } })
    const dapp = dapps[0]
    if (!dapp) throw new Error("dApp not found")
    if (dapp.owner_id === user.id) throw new Error("Creators already have access to their own content")
    const visibility = dapp[`${input.asset}_visibility`] as AssetVisibility
    if (visibility !== "paid") throw new Error(visibility === "free" ? "This content is already free" : "This content is private")
    const existing = await supabaseRequest<{ id: string }[]>({ path: "marketplace_purchases", query: { buyer_id: `eq.${user.id}`, dapp_id: `eq.${input.dappId}`, asset_type: `eq.${input.asset}`, select: "id", limit: "1" } })
    if (existing[0]) return NextResponse.json({ alreadyPurchased: true })
    const profiles = await supabaseRequest<{ id: string; wallet_address: string; chain: "evm" | "solana" }[]>({ path: "profiles", query: { id: `in.(${user.id},${dapp.owner_id})`, select: "id,wallet_address,chain" } })
    const buyer = profiles.find(profile => profile.id === user.id)
    const creator = profiles.find(profile => profile.id === dapp.owner_id)
    if (!buyer || !creator) throw new Error("Buyer or creator profile is unavailable")
    const network = buyer.chain === "solana" ? "solana" : "base"
    const creatorAddress = network === "base" ? dapp.base_payout_address || (creator.chain === "evm" ? creator.wallet_address : "") : dapp.solana_payout_address || (creator.chain === "solana" ? creator.wallet_address : "")
    if (!creatorAddress) throw new Error(`The creator has not configured a ${network === "base" ? "Base" : "Solana"} payout address yet`)
    const amount = Number(dapp[`${input.asset}_price_usdc`])
    const split = splitUsdc(amount)
    return NextResponse.json({
      dappId: input.dappId,
      dappName: dapp.name,
      asset: input.asset as MarketplaceAsset,
      network,
      amount,
      payer: buyer.wallet_address,
      creator: creatorAddress,
      platform: platformRecipient(network),
      creatorAmount: split.creatorAmount,
      platformAmount: split.platformAmount,
      creatorMicros: split.creatorMicros.toString(),
      platformMicros: split.platformMicros.toString(),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare marketplace purchase" }, { status: 400 })
  }
}
