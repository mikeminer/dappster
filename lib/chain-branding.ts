import type { Chain } from "@/types"

export type ChainBrand = {
  name: string
  logo: string
}

const evmChainBrands: Record<number, ChainBrand> = {
  1: { name: "Ethereum", logo: "/chain-logos/ethereum.svg" },
  10: { name: "Optimism", logo: "/chain-logos/optimism.svg" },
  137: { name: "Polygon", logo: "/chain-logos/polygon.svg" },
  143: { name: "Monad", logo: "/chain-logos/monad.svg" },
  56: { name: "BNB Smart Chain", logo: "/chain-logos/bnb.svg" },
  100: { name: "Gnosis", logo: "/chain-logos/gnosis.svg" },
  146: { name: "Sonic", logo: "/chain-logos/sonic.svg" },
  252: { name: "Fraxtal", logo: "/chain-logos/fraxtal.svg" },
  324: { name: "ZKsync Era", logo: "/chain-logos/zksync.svg" },
  999: { name: "HyperEVM", logo: "/chain-logos/hyperliquid.svg" },
  1088: { name: "Metis", logo: "/chain-logos/metis.svg" },
  4663: { name: "Robinhood Chain", logo: "/chain-logos/robinhood.svg" },
  5000: { name: "Mantle", logo: "/chain-logos/mantle.svg" },
  8453: { name: "Base", logo: "/chain-logos/base.svg" },
  33139: { name: "ApeChain", logo: "/chain-logos/apechain.svg" },
  34443: { name: "Mode", logo: "/chain-logos/mode.svg" },
  42161: { name: "Arbitrum One", logo: "/chain-logos/arbitrum.svg" },
  42220: { name: "Celo", logo: "/chain-logos/celo.svg" },
  43114: { name: "Avalanche C-Chain", logo: "/chain-logos/avalanche.svg" },
  59144: { name: "Linea", logo: "/chain-logos/linea.svg" },
  80094: { name: "Berachain", logo: "/chain-logos/berachain.svg" },
  81457: { name: "Blast", logo: "/chain-logos/blast.svg" },
  534352: { name: "Scroll", logo: "/chain-logos/scroll.svg" },
  84532: { name: "Base Sepolia", logo: "/chain-logos/base.svg" },
  11155111: { name: "Sepolia", logo: "/chain-logos/ethereum.svg" },
}

export function getChainBrand(chain: Chain, chainId?: number | null, contractNetwork?: string | null): ChainBrand {
  if (chain === "solana") return {
    name: contractNetwork?.toLowerCase() === "devnet" ? "Solana · Devnet" : "Solana",
    logo: "/chain-logos/solana.svg",
  }
  const nonEvm: Partial<Record<Chain, ChainBrand>> = {
    sui: { name: "Sui", logo: "/chain-logos/sui.svg" },
    aptos: { name: "Aptos", logo: "/chain-logos/aptos.svg" },
    cosmos: { name: "CosmWasm", logo: "/chain-logos/cosmos.svg" },
    ton: { name: "TON", logo: "/chain-logos/ton.svg" },
    near: { name: "NEAR", logo: "/chain-logos/near.svg" },
    starknet: { name: "Starknet", logo: "/chain-logos/starknet.svg" },
    algorand: { name: "Algorand", logo: "/chain-logos/algorand.svg" },
  }
  if (chain !== "evm") return nonEvm[chain] || { name: chain, logo: "/chain-logos/ethereum.svg" }
  return chainId && evmChainBrands[chainId]
    ? evmChainBrands[chainId]
    : { name: "EVM", logo: "/chain-logos/ethereum.svg" }
}
