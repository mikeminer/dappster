import { resolveIpfsUrl } from "@/lib/ipfs"
import type { PublicDapp } from "@/lib/public-dapps"
import type { Dapp } from "@/types"

export function toDappCard(dapp: PublicDapp): Dapp {
  const accents = ["blue", "purple", "cyan", "green", "orange", "pink"]
  const ownerId = dapp.owner_id || ""
  return {
    id: dapp.id,
    name: dapp.name,
    description: dapp.description || "An onchain application built with Dappster.",
    chain: dapp.chain,
    chainId: dapp.contract_chain_id,
    contractNetwork: dapp.contract_network,
    tags: dapp.tags || [],
    owner: dapp.publisher_name || (ownerId ? `${ownerId.slice(0, 5)}…${ownerId.slice(-4)}` : "Dappster"),
    ownerUsername: dapp.publisher_username || undefined,
    ownerPoints: dapp.publisher_points || 0,
    icon: dapp.name.slice(0, 1).toUpperCase(),
    accent: accents[dapp.name.length % accents.length],
    isFeatured: dapp.is_featured,
    ipfsUrl: resolveIpfsUrl(dapp.ipfs_hash, dapp.ipfs_url),
  }
}
