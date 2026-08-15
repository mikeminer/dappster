import { unstable_cache } from "next/cache"
import { normalizeWalletAddress } from "@/lib/accounts"
import { formatPublisher } from "@/lib/publisher"
import { hasSupabaseConfig } from "@/lib/runtime"
import { supabaseRequest } from "@/lib/supabase"
import type { Chain } from "@/types"

export type PointEligibleDapp = {
  id: string
  owner_id: string
  name: string
  chain: Chain
  contract_address?: string | null
  contract_chain_id?: number | null
  contract_network?: string | null
  deploy_status?: string | null
  ipfs_hash?: string | null
  ipfs_url?: string | null
  is_listed?: boolean | null
  created_at?: string | null
}

export type DappsterPointsEntry = {
  accountId: string
  username: string | null
  displayName: string
  points: number
  rank: number
  publicApps: number
  firstDappId: string | null
  breakdown: Record<string, number>
  wallets: Array<{ chain: "evm" | "solana"; address: string }>
  profileUrl: string | null
}

export type DappsterPointsSnapshot = {
  entries: DappsterPointsEntry[]
  dapps: PointEligibleDapp[]
  totalPoints: number
}

const PAGE_SIZE = 1000
const PROFILE_BATCH_SIZE = 100

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

export function isPointEligibleDapp(dapp: Partial<PointEligibleDapp>) {
  return dapp.is_listed === true
    && dapp.deploy_status === "live"
    && Boolean(dapp.contract_address)
    && Boolean(dapp.ipfs_hash || dapp.ipfs_url)
}

export function countDappsterPoints(dapps: Array<Partial<PointEligibleDapp>>) {
  return new Set(dapps.filter(isPointEligibleDapp).map(dapp => dapp.id).filter(Boolean)).size
}

function breakdownKey(dapp: PointEligibleDapp) {
  if (dapp.chain === "solana") return dapp.contract_network === "devnet" ? "Solana Devnet" : "Solana"
  return dapp.contract_network || dapp.chain.toUpperCase()
}

async function fetchAllEligibleDapps() {
  const rows: PointEligibleDapp[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await supabaseRequest<PointEligibleDapp[]>({
      path: "dapps",
      query: {
        select: "id,owner_id,name,chain,contract_address,contract_chain_id,contract_network,deploy_status,ipfs_hash,ipfs_url,is_listed,created_at",
        is_listed: "eq.true",
        deploy_status: "eq.live",
        contract_address: "not.is.null",
        or: "(ipfs_hash.not.is.null,ipfs_url.not.is.null)",
        order: "created_at.desc",
        offset: String(offset),
        limit: String(PAGE_SIZE),
      },
    })
    rows.push(...page.filter(isPointEligibleDapp))
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

async function loadDappsterPointsSnapshot(): Promise<DappsterPointsSnapshot> {
  if (!hasSupabaseConfig()) return { entries: [], dapps: [], totalPoints: 0 }

  const dapps = await fetchAllEligibleDapps()
  const ownerIds = Array.from(new Set(dapps.map(dapp => dapp.owner_id)))
  const profileBatches = chunks(ownerIds, PROFILE_BATCH_SIZE)
  const [profileRows, walletRows] = await Promise.all([
    Promise.all(profileBatches.map(ids => supabaseRequest<Array<{ id: string; username?: string | null }>>({
      path: "profiles",
      query: { id: `in.(${ids.join(",")})`, select: "id,username" },
    }))).then(batches => batches.flat()),
    Promise.all(profileBatches.map(ids => supabaseRequest<Array<{ account_id: string; wallet_address: string; chain: "evm" | "solana" }>>({
      path: "account_wallets",
      query: { account_id: `in.(${ids.join(",")})`, select: "account_id,wallet_address,chain", order: "created_at.asc" },
    }))).then(batches => batches.flat()),
  ])

  const usernames = new Map(profileRows.map(profile => [profile.id, profile.username || null]))
  const appsByOwner = new Map<string, PointEligibleDapp[]>()
  for (const dapp of dapps) appsByOwner.set(dapp.owner_id, [...(appsByOwner.get(dapp.owner_id) || []), dapp])

  const entries = ownerIds.map(accountId => {
    const publicApps = appsByOwner.get(accountId) || []
    const username = usernames.get(accountId) || null
    const wallets = walletRows
      .filter(wallet => wallet.account_id === accountId)
      .map(wallet => ({ chain: wallet.chain, address: normalizeWalletAddress(wallet.chain, wallet.wallet_address) }))
    const preferredWallet = wallets.find(wallet => wallet.chain === "evm") || wallets[0]
    const breakdown: Record<string, number> = {}
    for (const dapp of publicApps) {
      const key = breakdownKey(dapp)
      breakdown[key] = (breakdown[key] || 0) + 1
    }
    return {
      accountId,
      username,
      displayName: formatPublisher({ username, wallet_address: preferredWallet?.address }, accountId),
      points: publicApps.length,
      rank: 0,
      publicApps: publicApps.length,
      firstDappId: publicApps[0]?.id || null,
      breakdown,
      wallets,
      profileUrl: username ? `/creator/${encodeURIComponent(username)}` : null,
    }
  }).sort((left, right) => right.points - left.points || left.displayName.localeCompare(right.displayName))
    .map((entry, index) => ({ ...entry, rank: index + 1 }))

  return { entries, dapps, totalPoints: dapps.length }
}

const getCachedDappsterPointsSnapshot = unstable_cache(
  loadDappsterPointsSnapshot,
  ["dappster-points-v1"],
  { revalidate: 60, tags: ["dappster-points", "public-dapps"] },
)

export function getDappsterPointsSnapshot() {
  return getCachedDappsterPointsSnapshot()
}

export async function getAccountPoints(accountId: string) {
  const snapshot = await getDappsterPointsSnapshot()
  return snapshot.entries.find(entry => entry.accountId === accountId) || null
}

export async function resolveDappsterPointsAddress(address: string) {
  const trimmed = address.trim()
  const chain = /^0x[0-9a-fA-F]{40}$/.test(trimmed)
    ? "evm"
    : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed) ? "solana" : null
  if (!chain) throw new Error("Enter a valid EVM or Solana wallet address")
  if (!hasSupabaseConfig()) return { chain, entry: null }

  const normalized = normalizeWalletAddress(chain, trimmed)
  const wallets = await supabaseRequest<Array<{ account_id: string }>>({
    path: "account_wallets",
    query: {
      chain: `eq.${chain}`,
      wallet_address: chain === "evm" ? `ilike.${normalized}` : `eq.${normalized}`,
      select: "account_id",
      limit: "1",
    },
  })
  const entry = wallets[0] ? await getAccountPoints(wallets[0].account_id) : null
  return { chain, entry }
}

export async function getDappsterLeaderboard({ page = 1, limit = 25, search = "" } = {}) {
  const safePage = Math.max(1, page)
  const safeLimit = Math.min(100, Math.max(1, limit))
  const needle = search.trim().toLowerCase().slice(0, 80)
  const snapshot = await getDappsterPointsSnapshot()
  const matching = needle
    ? snapshot.entries.filter(entry => `${entry.displayName} ${entry.username || ""} ${entry.wallets.map(wallet => wallet.address).join(" ")}`.toLowerCase().includes(needle))
    : snapshot.entries
  const start = (safePage - 1) * safeLimit
  return {
    entries: matching.slice(start, start + safeLimit),
    page: safePage,
    limit: safeLimit,
    total: matching.length,
    totalPages: Math.max(1, Math.ceil(matching.length / safeLimit)),
    totalPoints: snapshot.totalPoints,
  }
}

export async function getCreatorPointsProfile(username: string) {
  const snapshot = await getDappsterPointsSnapshot()
  const entry = snapshot.entries.find(item => item.username?.toLowerCase() === username.trim().toLowerCase())
  if (!entry) return null
  return { entry, dapps: snapshot.dapps.filter(dapp => dapp.owner_id === entry.accountId) }
}
