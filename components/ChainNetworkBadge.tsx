import Image from "next/image"
import { getChainBrand } from "@/lib/chain-branding"
import type { Chain } from "@/types"

export function ChainNetworkBadge({ chain, chainId, contractNetwork }: { chain: Chain; chainId?: number | null; contractNetwork?: string | null }) {
  const network = getChainBrand(chain, chainId, contractNetwork)
  return <span className="chain-badge chain-network-badge"><Image className="chain-logo" src={network.logo} alt="" width={16} height={16} aria-hidden="true" /><span>{network.name}</span></span>
}
