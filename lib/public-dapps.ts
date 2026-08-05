import { formatPublisher } from "@/lib/publisher"
import { localListDapps } from "@/lib/local-store"
import { listPublicDappListings } from "@/lib/pinata-listings"
import { hasSupabaseConfig } from "@/lib/runtime"
import { supabaseRequest } from "@/lib/supabase"
import type { Chain } from "@/types"
import { isChain } from "@/lib/chain-adapters"

export type PublicDapp = Record<string, unknown> & {
  id: string
  owner_id?: string
  name: string
  description?: string
  chain: Chain
  contract_chain_id?: number | null
  contract_network?: string | null
  tags?: string[]
  is_featured?: boolean
  publisher_name?: string
  ipfs_hash?: string
  ipfs_url?: string
}

export async function getPublicDapps({ page = 1, limit = 12, chain, featured, tags, search }: {
  page?: number
  limit?: number
  chain?: string | null
  featured?: boolean
  tags?: string | null
  search?: string | null
} = {}) {
  const safePage = Math.max(1, page)
  const safeLimit = Math.min(50, Math.max(1, limit))
  const safeSearch = search?.trim().replace(/[,.*%(){}\[\]"'\\]/g, " ").replace(/\s+/g, " ").slice(0, 80) || ""
  const safeTags = tags?.split(",")
    .map(tag => tag.trim().replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 30))
    .filter(Boolean)
    .slice(0, 6) || []

  if (!hasSupabaseConfig()) {
    const persistent = await listPublicDappListings()
    const combined = [...persistent]
    for (const local of localListDapps({ listedOnly: true })) {
      if (!combined.some(dapp => dapp.id === local.id)) combined.push({
        ...local,
        contract_address: local.contract_address || undefined,
        ipfs_hash: local.ipfs_hash || undefined,
        ipfs_url: local.ipfs_url || undefined,
      })
    }
    const start = (safePage - 1) * safeLimit
    const matching = combined
      .filter(dapp => !isChain(chain) || dapp.chain === chain)
      .filter(dapp => !featured || dapp.is_featured)
      .filter(dapp => !safeSearch || `${dapp.name} ${dapp.description || ""} ${(dapp.tags || []).join(" ")}`.toLowerCase().includes(safeSearch.toLowerCase()))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    const hasMore = matching.length > start + safeLimit
    const dapps = matching.slice(start, start + safeLimit)
      .map(dapp => ({
        ...(dapp.app_visibility === false ? { ...dapp, ipfs_hash: undefined, ipfs_url: undefined } : dapp),
        publisher_name: formatPublisher(undefined, dapp.owner_id),
      }))
    return { dapps: dapps as PublicDapp[], page: safePage, limit: safeLimit, hasMore, mode: "pinata" as const }
  }

  const query: Record<string, string> = {
    select: "id,owner_id,name,description,chain,contract_address,contract_chain_id,contract_network,ipfs_hash,ipfs_url,app_visibility,frontend_visibility,is_featured,tags,screenshot_url,created_at",
    is_listed: "eq.true",
    order: "is_featured.desc,created_at.desc",
    offset: String((safePage - 1) * safeLimit),
    limit: String(safeLimit + 1),
  }
  if (isChain(chain)) query.chain = `eq.${chain}`
  if (featured) query.is_featured = "eq.true"
  if (safeTags.length) query.tags = `ov.{${safeTags.join(",")}}`
  if (safeSearch) query.or = `(name.ilike.*${safeSearch}*,description.ilike.*${safeSearch}*,tags.cs.{${safeSearch}})`

  const fetchedRows = await supabaseRequest<Array<Record<string, unknown>>>({ path: "dapps", query })
  const hasMore = fetchedRows.length > safeLimit
  const rows = fetchedRows.slice(0, safeLimit)
  const ownerIds = Array.from(new Set(rows.map(dapp => String(dapp.owner_id || "")).filter(Boolean)))
  const [profiles, wallets] = ownerIds.length ? await Promise.all([
    supabaseRequest<Array<{ id: string; username?: string | null }>>({ path: "profiles", query: { id: `in.(${ownerIds.join(",")})`, select: "id,username" } }),
    supabaseRequest<Array<{ account_id: string; wallet_address: string; chain: string }>>({ path: "account_wallets", query: { account_id: `in.(${ownerIds.join(",")})`, select: "account_id,wallet_address,chain" } }),
  ]) : [[], []]
  const usernames = new Map(profiles.map(profile => [profile.id, profile.username]))
  const dapps = rows.map(dapp => {
    const ownerId = String(dapp.owner_id || "")
    const wallet = wallets.find(item => item.account_id === ownerId && item.chain === dapp.chain)
    const publisher_name = formatPublisher({ username: usernames.get(ownerId), wallet_address: wallet?.wallet_address }, ownerId)
    const visible = dapp.app_visibility === false ? { ...dapp, ipfs_hash: undefined, ipfs_url: undefined } : dapp
    return { ...visible, publisher_name }
  })
  return { dapps: dapps as PublicDapp[], page: safePage, limit: safeLimit, hasMore }
}
