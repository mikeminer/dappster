import { randomUUID } from "crypto"
import type { AuditReport, Chain } from "@/types"
import type { AssetVisibility } from "@/lib/marketplace"

export type LocalDapp = {
  id: string
  owner_id: string
  name: string
  description: string
  chain: Chain
  contract_code: string
  frontend_code: string
  contract_address?: string | null
  contract_tx_hash?: string | null
  contract_chain_id?: number | null
  contract_network?: string | null
  contract_deployed_at?: string | null
  ipfs_hash?: string | null
  ipfs_url?: string | null
  app_visibility?: boolean
  deploy_status: "draft" | "deploying" | "live" | "failed"
  is_listed: boolean
  is_featured: boolean
  tags: string[]
  audit_status: "none" | "pending" | "completed"
  source_visibility?: AssetVisibility
  frontend_visibility?: AssetVisibility
  audit_visibility?: AssetVisibility
  deploy_visibility?: AssetVisibility
  source_price_usdc?: number
  frontend_price_usdc?: number
  audit_price_usdc?: number
  deploy_price_usdc?: number
  base_payout_address?: string | null
  solana_payout_address?: string | null
  created_at: string
  updated_at: string
}

type Store = {
  credits: Map<string, number>
  usernames: Map<string, string>
  dapps: Map<string, LocalDapp>
  audits: Map<string, { id: string; owner_id: string; dapp_id?: string; report: AuditReport }>
  plans: Map<string, { plan: "pro"; expiresAt: string }>
  paymentIds: Set<string>
}

const globalStore = globalThis as typeof globalThis & { __dappsterStore?: Store }

function store(): Store {
  if (!globalStore.__dappsterStore) {
    globalStore.__dappsterStore = { credits: new Map(), usernames: new Map(), dapps: new Map(), audits: new Map(), plans: new Map(), paymentIds: new Set() }
  }
  globalStore.__dappsterStore.usernames ||= new Map()
  globalStore.__dappsterStore.plans ||= new Map()
  globalStore.__dappsterStore.paymentIds ||= new Set()
  return globalStore.__dappsterStore
}

export function localCredits(userId: string) {
  const value = store().credits.get(userId)
  if (value !== undefined) return value
  store().credits.set(userId, 0)
  return 0
}

export function localSpend(userId: string, amount: number) {
  const current = localCredits(userId)
  if (current < amount) throw new Error(`You need ${amount} credits for this action`)
  const remaining = current - amount
  store().credits.set(userId, remaining)
  return remaining
}

export function localProfile(userId: string) {
  const active = store().plans.get(userId)
  const isActive = Boolean(active && new Date(active.expiresAt).getTime() > Date.now())
  if (active && !isActive) store().plans.delete(userId)
  return { username: store().usernames.get(userId) || "local-builder", credits: localCredits(userId), plan: isActive ? "pro" : "free", plan_expires_at: isActive ? active?.expiresAt : null }
}

export function localSetUsername(userId: string, username: string) {
  store().usernames.set(userId, username)
  return username
}

export function localApplyPayment(userId: string, paymentId: string, selected: { credits: number; plan: string | null }) {
  if (store().paymentIds.has(paymentId)) return localProfile(userId)
  store().paymentIds.add(paymentId)
  if (selected.plan === "pro") {
    const current = store().plans.get(userId)
    const start = Math.max(Date.now(), current ? new Date(current.expiresAt).getTime() : 0)
    store().plans.set(userId, { plan: "pro", expiresAt: new Date(start + 30 * 24 * 60 * 60 * 1000).toISOString() })
  } else {
    store().credits.set(userId, localCredits(userId) + selected.credits)
  }
  return localProfile(userId)
}

export function localCreateDapp(input: Omit<LocalDapp, "id" | "created_at" | "updated_at">) {
  const now = new Date().toISOString()
  const dapp: LocalDapp = { ...input, id: randomUUID(), created_at: now, updated_at: now }
  store().dapps.set(dapp.id, dapp)
  return dapp
}

export function localGetDapp(id: string) {
  return store().dapps.get(id)
}

export function localUpdateDapp(id: string, input: Partial<LocalDapp>) {
  const current = localGetDapp(id)
  if (!current) throw new Error("dApp not found")
  const updated = { ...current, ...input, id: current.id, updated_at: new Date().toISOString() }
  store().dapps.set(id, updated)
  return updated
}

export function localDeleteDapp(id: string) {
  const current = localGetDapp(id)
  if (!current) throw new Error("dApp not found")
  store().dapps.delete(id)
  const auditIds: string[] = []
  store().audits.forEach((audit, auditId) => {
    if (audit.dapp_id === id) auditIds.push(auditId)
  })
  auditIds.forEach(auditId => store().audits.delete(auditId))
  return current
}

export function localListDapps(options: { ownerId?: string; listedOnly?: boolean } = {}) {
  return Array.from(store().dapps.values())
    .filter(dapp => !options.ownerId || dapp.owner_id === options.ownerId)
    .filter(dapp => !options.listedOnly || dapp.is_listed)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function localSaveAudit(ownerId: string, dappId: string | undefined, report: AuditReport) {
  const id = randomUUID()
  store().audits.set(id, { id, owner_id: ownerId, dapp_id: dappId, report })
  return id
}
