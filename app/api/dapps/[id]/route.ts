import { NextResponse } from "next/server"
import { z } from "zod"
import { CHAIN_IDS } from "@/lib/chain-adapters"
import { getOptionalRequestUser, getRequestUser, hasSupabaseConfig } from "@/lib/runtime"
import { localDeleteDapp, localGetDapp, localUpdateDapp } from "@/lib/local-store"
import { supabaseRequest } from "@/lib/supabase"
import { listPublicDappListings, savePublicDappListing } from "@/lib/pinata-listings"
import { marketplaceAssets, type AssetVisibility, type MarketplaceAsset } from "@/lib/marketplace"
import { formatPublisher } from "@/lib/publisher"

type StoredDapp = Record<string, unknown> & {
  id: string
  owner_id: string
  is_listed: boolean
  contract_code?: string | null
  frontend_code?: string | null
  ipfs_hash?: string | null
  ipfs_url?: string | null
  app_visibility?: boolean
  source_visibility?: AssetVisibility
  frontend_visibility?: AssetVisibility
  audit_visibility?: AssetVisibility
  deploy_visibility?: AssetVisibility
  source_price_usdc?: number | string
  frontend_price_usdc?: number | string
  audit_price_usdc?: number | string
  deploy_price_usdc?: number | string
  base_payout_address?: string | null
  solana_payout_address?: string | null
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!hasSupabaseConfig()) {
      const dapp = localGetDapp(id)
      if (dapp) return NextResponse.json(dapp.app_visibility === false ? { ...dapp, ipfs_hash: undefined, ipfs_url: undefined } : dapp)
      const listing = (await listPublicDappListings()).find(item => item.id === id)
      if (!listing) return NextResponse.json({ error: "dApp not found" }, { status: 404 })
      return NextResponse.json(listing.app_visibility === false ? { ...listing, ipfs_hash: undefined, ipfs_url: undefined } : listing)
    }
    const user = await getOptionalRequestUser(request)
    const rows = await supabaseRequest<StoredDapp[]>({ path: "dapps", query: { id: `eq.${id}`, select: "*", limit: "1" } })
    const dapp = rows[0]
    const isOwner = Boolean(user && dapp?.owner_id === user.id)
    if (!dapp || (!dapp.is_listed && !isOwner)) return NextResponse.json({ error: "dApp not found" }, { status: 404 })

    const [publisherProfiles, publisherWallets] = await Promise.all([
      supabaseRequest<Array<{ username?: string | null }>>({ path: "profiles", query: { id: `eq.${dapp.owner_id}`, select: "username", limit: "1" } }),
      supabaseRequest<Array<{ wallet_address: string; chain: string }>>({ path: "account_wallets", query: { account_id: `eq.${dapp.owner_id}`, select: "wallet_address,chain" } }),
    ])
    const publisherWallet = publisherWallets.find(wallet => wallet.chain === dapp.chain)
    const publisherName = formatPublisher({ username: publisherProfiles[0]?.username, wallet_address: publisherWallet?.wallet_address }, dapp.owner_id)

    const purchases = user && !isOwner
      ? await supabaseRequest<{ asset_type: MarketplaceAsset }[]>({ path: "marketplace_purchases", query: { buyer_id: `eq.${user.id}`, dapp_id: `eq.${dapp.id}`, select: "asset_type" } })
      : []
    const purchased = new Set(purchases.map(item => item.asset_type))
    const marketplace = Object.fromEntries(marketplaceAssets.map(asset => {
      const visibility = (dapp[`${asset}_visibility`] || "private") as AssetVisibility
      const price = Number(dapp[`${asset}_price_usdc`] || 5)
      return [asset, { visibility, price, unlocked: isOwner || visibility === "free" || purchased.has(asset), purchased: purchased.has(asset) }]
    })) as Record<MarketplaceAsset, { visibility: AssetVisibility; price: number; unlocked: boolean; purchased: boolean }>
    const latestAudit = marketplace.audit.unlocked && dapp.audit_status === "completed"
      ? (await supabaseRequest<{ report: unknown; severity_counts: unknown; created_at: string }[]>({ path: "audits", query: { dapp_id: `eq.${dapp.id}`, status: "eq.completed", select: "report,severity_counts,created_at", order: "created_at.desc", limit: "1" } }))[0]
      : null
    const { contract_code, frontend_code, ipfs_hash, ipfs_url, app_visibility, base_payout_address, solana_payout_address, ...publicDapp } = dapp
    return NextResponse.json({
      ...publicDapp,
      ...(marketplace.source.unlocked ? { contract_code } : {}),
      ...(marketplace.frontend.unlocked ? { frontend_code } : {}),
      ...((isOwner || app_visibility !== false) && (ipfs_hash || ipfs_url) ? { ipfs_hash, ipfs_url } : {}),
      app_visibility: app_visibility !== false,
      publisher_name: publisherName,
      ...(marketplace.audit.unlocked && latestAudit ? { audit_report: latestAudit.report, audit_created_at: latestAudit.created_at } : {}),
      ...(isOwner ? { base_payout_address, solana_payout_address } : {}),
      marketplace,
      viewer: { isOwner, authenticated: Boolean(user) },
    })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load dApp" }, { status: 500 }) }
}

const listingSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(600).optional(),
  chain: z.enum(CHAIN_IDS),
  tags: z.array(z.string().max(30)).max(6).optional(),
  contract_address: z.string().max(100).optional(),
  ipfs_hash: z.string().max(100).optional(),
  ipfs_url: z.string().max(500).optional(),
  deploy_status: z.string().max(30).optional(),
})
const updateSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(600).optional(),
  tags: z.array(z.string()).max(6).optional(),
  contract_address: z.string().max(100).optional(),
  is_listed: z.boolean().optional(),
  app_visibility: z.boolean().optional(),
  source_visibility: z.enum(["private", "free", "paid"]).optional(),
  frontend_visibility: z.enum(["private", "free", "paid"]).optional(),
  audit_visibility: z.enum(["private", "free", "paid"]).optional(),
  deploy_visibility: z.enum(["private", "free", "paid"]).optional(),
  source_price_usdc: z.number().min(1).max(10000).optional(),
  frontend_price_usdc: z.number().min(1).max(10000).optional(),
  audit_price_usdc: z.number().min(1).max(10000).optional(),
  deploy_price_usdc: z.number().min(1).max(10000).optional(),
  base_payout_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).nullable().optional(),
  solana_payout_address: z.string().min(32).max(44).nullable().optional(),
  listing: listingSchema.optional(),
})
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getRequestUser(request)
    const input = updateSchema.parse(await request.json())
    if (user.isDemo) {
      const current = localGetDapp(id)
      if (current && current.owner_id !== user.id) return NextResponse.json({ error: "dApp not found" }, { status: 404 })
      if (!current && !input.listing) return NextResponse.json({ error: "dApp not found" }, { status: 404 })
      if (current) {
        const { listing: _listing, ...updates } = input
        localUpdateDapp(id, updates)
      }
      if (input.is_listed !== undefined) {
        const source = input.listing || current
        if (!source) return NextResponse.json({ error: "Listing data is required" }, { status: 400 })
        await savePublicDappListing({
          id,
          owner_id: user.id,
          name: source.name,
          description: source.description,
          chain: source.chain,
          tags: source.tags,
          contract_address: source.contract_address || undefined,
          ipfs_hash: "ipfs_hash" in source ? source.ipfs_hash || undefined : undefined,
          ipfs_url: "ipfs_url" in source ? source.ipfs_url || undefined : undefined,
          app_visibility: input.app_visibility ?? current?.app_visibility ?? true,
          frontend_visibility: input.frontend_visibility || current?.frontend_visibility || "private",
          deploy_status: "deploy_status" in source ? source.deploy_status : undefined,
          is_featured: false,
          is_listed: input.is_listed,
        })
      }
      return NextResponse.json({ ok: true, is_listed: input.is_listed, mode: "pinata" })
    }
    const { listing: _listing, ...updates } = input
    await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${id}`, owner_id: `eq.${user.id}` }, body: { ...updates, updated_at: new Date().toISOString() } })
    return NextResponse.json({ ok: true })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update dApp" }, { status: 400 }) }
}

const deleteSchema = z.object({
  confirmation: z.literal("I PERMANENTLY DELETE THIS CREATION"),
})

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getRequestUser(request)
    deleteSchema.parse(await request.json())

    if (user.isDemo) {
      const current = localGetDapp(id)
      if (!current || current.owner_id !== user.id) return NextResponse.json({ error: "dApp not found" }, { status: 404 })
      if (current.is_listed) {
        await savePublicDappListing({
          id: current.id,
          owner_id: current.owner_id,
          name: current.name,
          description: current.description,
          chain: current.chain,
          tags: current.tags,
          contract_address: current.contract_address || undefined,
          ipfs_hash: current.ipfs_hash || undefined,
          ipfs_url: current.ipfs_url || undefined,
          app_visibility: current.app_visibility !== false,
          frontend_visibility: current.frontend_visibility || "private",
          deploy_status: current.deploy_status,
          is_featured: false,
          is_listed: false,
        })
      }
      localDeleteDapp(id)
      return NextResponse.json({ ok: true })
    }

    const rows = await supabaseRequest<Array<{ id: string }>>({
      path: "dapps",
      query: { id: `eq.${id}`, owner_id: `eq.${user.id}`, select: "id", limit: "1" },
    })
    if (!rows[0]) return NextResponse.json({ error: "dApp not found" }, { status: 404 })

    await supabaseRequest({
      path: "dapps",
      method: "DELETE",
      query: { id: `eq.${id}`, owner_id: `eq.${user.id}` },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Type the required confirmation statement exactly" }, { status: 400 })
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete dApp" }, { status: 400 })
  }
}
