import { defineChain, fallback, http, type Chain } from "viem"
import {
  apeChain as viemApeChain,
  arbitrum as viemArbitrum,
  avalanche as viemAvalanche,
  base as viemBase,
  baseSepolia as viemBaseSepolia,
  berachain as viemBerachain,
  blast as viemBlast,
  bsc as viemBsc,
  celo as viemCelo,
  fraxtal as viemFraxtal,
  gnosis as viemGnosis,
  hyperEvm as viemHyperEvm,
  linea as viemLinea,
  mainnet as viemMainnet,
  mantle as viemMantle,
  metis as viemMetis,
  mode as viemMode,
  monad as viemMonad,
  optimism as viemOptimism,
  polygon as viemPolygon,
  scroll as viemScroll,
  sepolia as viemSepolia,
  sonic as viemSonic,
  zksync as viemZksync,
} from "viem/chains"

function withRpcFallbacks<T extends Chain>(chain: T, urls: readonly string[]) {
  return defineChain({
    ...chain,
    rpcUrls: {
      ...chain.rpcUrls,
      default: { ...chain.rpcUrls.default, http: [...urls] },
    },
  })
}

export const base = withRpcFallbacks(viemBase, ["https://mainnet.base.org", "https://base-rpc.publicnode.com"])
export const apeChain = withRpcFallbacks(viemApeChain, ["https://rpc.apechain.com/http"])
export const mainnet = withRpcFallbacks(viemMainnet, ["https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com"])
export const arbitrum = withRpcFallbacks(viemArbitrum, ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"])
export const optimism = withRpcFallbacks(viemOptimism, ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"])
export const linea = withRpcFallbacks(viemLinea, ["https://rpc.linea.build", "https://linea-rpc.publicnode.com"])
export const sepolia = withRpcFallbacks(viemSepolia, ["https://sepolia.drpc.org", "https://1rpc.io/sepolia", "https://ethereum-sepolia-rpc.publicnode.com"])
export const baseSepolia = withRpcFallbacks(viemBaseSepolia, ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"])
export const hyperEvm = withRpcFallbacks(viemHyperEvm, ["https://rpc.hyperliquid.xyz/evm"])
export const polygon = withRpcFallbacks(viemPolygon, ["https://polygon.drpc.org", "https://polygon-rpc.com", "https://polygon.publicnode.com"])
export const avalanche = withRpcFallbacks(viemAvalanche, ["https://api.avax.network/ext/bc/C/rpc", "https://avalanche-c-chain-rpc.publicnode.com"])
export const bsc = withRpcFallbacks(viemBsc, ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"])
export const gnosis = withRpcFallbacks(viemGnosis, ["https://rpc.gnosischain.com", "https://gnosis-rpc.publicnode.com"])
export const celo = withRpcFallbacks(viemCelo, ["https://forno.celo.org", "https://celo-rpc.publicnode.com"])
export const scroll = withRpcFallbacks(viemScroll, ["https://rpc.scroll.io", "https://scroll-rpc.publicnode.com"])
export const zksync = withRpcFallbacks(viemZksync, ["https://mainnet.era.zksync.io"])
export const mantle = withRpcFallbacks(viemMantle, ["https://rpc.mantle.xyz", "https://mantle-rpc.publicnode.com"])
export const blast = withRpcFallbacks(viemBlast, ["https://rpc.blast.io", "https://blast-rpc.publicnode.com"])
export const mode = withRpcFallbacks(viemMode, ["https://mainnet.mode.network"])
export const berachain = withRpcFallbacks(viemBerachain, ["https://rpc.berachain.com"])
export const sonic = withRpcFallbacks(viemSonic, ["https://rpc.soniclabs.com", "https://sonic-rpc.publicnode.com"])
export const fraxtal = withRpcFallbacks(viemFraxtal, ["https://rpc.frax.com"])
export const metis = withRpcFallbacks(viemMetis, ["https://andromeda.metis.io/?owner=1088", "https://metis-mainnet.public.blastapi.io"])
export const monad = withRpcFallbacks(viemMonad, ["https://rpc.monad.xyz", "https://rpc1.monad.xyz"])

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Robinhood Chain Explorer", url: "https://robinhoodchain.blockscout.com" },
  },
})

export const SUPPORTED_EVM_CHAINS = [
  base,
  apeChain,
  mainnet,
  arbitrum,
  optimism,
  polygon,
  avalanche,
  bsc,
  gnosis,
  celo,
  scroll,
  linea,
  zksync,
  mantle,
  blast,
  mode,
  berachain,
  sonic,
  fraxtal,
  metis,
  monad,
  robinhood,
  hyperEvm,
  sepolia,
  baseSepolia,
] as const
export const DEFAULT_EVM_CHAIN_ID = base.id
export type SupportedEvmChain = (typeof SUPPORTED_EVM_CHAINS)[number]

export function getSupportedEvmChain(chainId: number) {
  return SUPPORTED_EVM_CHAINS.find(chain => chain.id === chainId)
}

export function getEvmTransport(chain: SupportedEvmChain) {
  const urls = chain.rpcUrls.default.http as readonly string[]
  const transports = urls.map(url => http(url))
  return transports.length > 1 ? fallback(transports) : transports[0]
}

export const EVM_EXPLORERS: Record<number, string> = {
  [mainnet.id]: "https://etherscan.io",
  [base.id]: "https://basescan.org",
  [apeChain.id]: "https://apescan.io",
  [robinhood.id]: "https://robinhoodchain.blockscout.com",
  [hyperEvm.id]: "https://hyperevmscan.io",
  [polygon.id]: "https://polygonscan.com",
  [arbitrum.id]: "https://arbiscan.io",
  [optimism.id]: "https://optimistic.etherscan.io",
  [linea.id]: "https://lineascan.build",
  [avalanche.id]: "https://snowtrace.io",
  [bsc.id]: "https://bscscan.com",
  [gnosis.id]: "https://gnosisscan.io",
  [celo.id]: "https://celoscan.io",
  [scroll.id]: "https://scrollscan.com",
  [zksync.id]: "https://explorer.zksync.io",
  [mantle.id]: "https://explorer.mantle.xyz",
  [blast.id]: "https://blastscan.io",
  [mode.id]: "https://explorer.mode.network",
  [berachain.id]: "https://berascan.com",
  [sonic.id]: "https://sonicscan.org",
  [fraxtal.id]: "https://fraxscan.com",
  [metis.id]: "https://explorer.metis.io",
  [monad.id]: "https://monadscan.com",
  [sepolia.id]: "https://sepolia.etherscan.io",
  [baseSepolia.id]: "https://sepolia.basescan.org",
}
