import Image from "next/image"
import { getChainBrand } from "@/lib/chain-branding"
import type { Chain } from "@/types"

export function ChainNetworkBadge({ chain, chainId, network }: { chain: Chain; chainId?: number | null; network?: string | null }) {
  const brand = getChainBrand(chain, chainId, network)
  return <span className="chain-badge chain-network-badge"><Image className="chain-logo" src={brand.logo} alt="" width={16} height={16} aria-hidden="true" /><span>{brand.name}</span></span>
}
