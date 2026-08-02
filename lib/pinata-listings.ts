import type { Chain } from "@/types"

export type PublicDappListing = {
  id: string
  owner_id: string
  name: string
  description?: string
  chain: Chain
  tags?: string[]
  contract_address?: string
  ipfs_hash?: string
  ipfs_url?: string
  app_visibility?: boolean
  frontend_visibility?: "private" | "free" | "paid"
  deploy_status?: string
  is_featured?: boolean
  is_listed: boolean
  updated_at: string
}

type PinataFile = {
  cid: string
  keyvalues?: Record<string, string>
  created_at: string
}

function pinataHeaders() {
  if (!process.env.PINATA_JWT) throw new Error("PINATA_JWT is not configured")
  return { Authorization: `Bearer ${process.env.PINATA_JWT}` }
}

export async function savePublicDappListing(listing: Omit<PublicDappListing, "updated_at">) {
  const record: PublicDappListing = { ...listing, updated_at: new Date().toISOString() }
  const fileName = `dappster-listing-${listing.id}.json`
  const form = new FormData()
  form.append("file", new Blob([JSON.stringify(record)], { type: "application/json" }), fileName)
  form.append("network", "public")
  form.append("name", fileName)
  form.append("keyvalues", JSON.stringify({
    dappster_listing: "true",
    dapp_id: listing.id,
    owner_id: listing.owner_id,
    is_listed: String(listing.is_listed),
  }))
  const response = await fetch("https://uploads.pinata.cloud/v3/files", {
    method: "POST",
    headers: pinataHeaders(),
    body: form,
  })
  if (!response.ok) throw new Error(`Could not persist visibility (${response.status})`)
  return record
}

export async function listPublicDappListings() {
  if (!process.env.PINATA_JWT) return []
  const response = await fetch("https://api.pinata.cloud/v3/files/public?limit=100&order=DESC", {
    headers: pinataHeaders(),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`Could not load public listings (${response.status})`)
  const payload = await response.json() as { data?: { files?: PinataFile[] } }
  const files = (payload.data?.files || [])
    .filter(file => file.keyvalues?.dappster_listing === "true" && file.keyvalues.dapp_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  const latest = new Map<string, PinataFile>()
  for (const file of files) {
    const dappId = file.keyvalues?.dapp_id
    if (dappId && !latest.has(dappId)) latest.set(dappId, file)
  }

  const visible = Array.from(latest.values()).filter(file => file.keyvalues?.is_listed === "true")
  const listings = await Promise.all(visible.map(async file => {
    try {
      const response = await fetch(`https://dweb.link/ipfs/${encodeURIComponent(file.cid)}`, { cache: "no-store" })
      if (!response.ok) return null
      return await response.json() as PublicDappListing
    } catch {
      return null
    }
  }))
  return listings.filter((listing): listing is PublicDappListing => Boolean(listing?.id && listing.is_listed))
}
