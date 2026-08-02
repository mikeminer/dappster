import { BASE_PAYMENT_RECIPIENT, SOLANA_PAYMENT_RECIPIENT } from "@/lib/payments"

export const MARKETPLACE_PLATFORM_BPS = 1000
export const MARKETPLACE_CREATOR_BPS = 9000

export type MarketplaceAsset = "source" | "frontend" | "audit" | "deploy"
export type AssetVisibility = "private" | "free" | "paid"
export type MarketplaceNetwork = "base" | "solana"

export const marketplaceAssets: MarketplaceAsset[] = ["source", "frontend", "audit", "deploy"]

export function assetVisibilityField(asset: MarketplaceAsset) {
  return `${asset}_visibility` as const
}

export function assetPriceField(asset: MarketplaceAsset) {
  return `${asset}_price_usdc` as const
}

export function splitUsdc(amount: number) {
  const micros = BigInt(Math.round(amount * 1_000_000))
  const platformMicros = micros * BigInt(MARKETPLACE_PLATFORM_BPS) / BigInt(10_000)
  const creatorMicros = micros - platformMicros
  return {
    totalMicros: micros,
    creatorMicros,
    platformMicros,
    creatorAmount: Number(creatorMicros) / 1_000_000,
    platformAmount: Number(platformMicros) / 1_000_000,
  }
}

export function platformRecipient(network: MarketplaceNetwork) {
  return network === "base" ? BASE_PAYMENT_RECIPIENT : SOLANA_PAYMENT_RECIPIENT
}

export function publicDappFields() {
  return "id,owner_id,name,description,chain,contract_address,contract_tx_hash,contract_chain_id,contract_deployed_at,ipfs_hash,ipfs_url,deploy_status,is_listed,is_featured,tags,screenshot_url,audit_status,source_visibility,frontend_visibility,audit_visibility,deploy_visibility,source_price_usdc,frontend_price_usdc,audit_price_usdc,deploy_price_usdc,created_at,updated_at"
}
