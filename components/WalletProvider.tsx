"use client"

import { createContext, useContext, useMemo, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from "@solana/wallet-adapter-react"
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom"
import { WagmiProvider } from "wagmi"
import { DAppKitProvider } from "@mysten/dapp-kit-react"
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react"
import { Network } from "@aptos-labs/ts-sdk"
import { wagmiConfig } from "@/lib/wagmi-config"
import { suiDAppKit } from "@/lib/sui-dapp-kit"

export type SolanaDeploymentCluster = "devnet" | "mainnet-beta"

type SolanaDeploymentNetwork = {
  cluster: SolanaDeploymentCluster
  endpoint: string
  setCluster: (cluster: SolanaDeploymentCluster) => void
}

const SolanaDeploymentNetworkContext = createContext<SolanaDeploymentNetwork | null>(null)

export function useSolanaDeploymentNetwork() {
  const value = useContext(SolanaDeploymentNetworkContext)
  if (!value) throw new Error("Solana deployment network provider is unavailable")
  return value
}

export function Web3Providers({ children }: { children: React.ReactNode }) {
  return <EvmSolanaProviders><DAppKitProvider dAppKit={suiDAppKit}><AptosWalletAdapterProvider autoConnect dappConfig={{ network: Network.DEVNET }} disableTelemetry>{children}</AptosWalletAdapterProvider></DAppKitProvider></EvmSolanaProviders>
}

export function EvmSolanaProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  const [cluster, setCluster] = useState<SolanaDeploymentCluster>("devnet")
  const wallets = useMemo(() => [new PhantomWalletAdapter()], [])
  const endpoint = cluster === "devnet"
    ? process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL || "https://api.devnet.solana.com"
    : process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"
  const solanaNetwork = useMemo(() => ({ cluster, endpoint, setCluster }), [cluster, endpoint])
  return <WagmiProvider config={wagmiConfig}><QueryClientProvider client={queryClient}><SolanaDeploymentNetworkContext.Provider value={solanaNetwork}><ConnectionProvider endpoint={endpoint}><SolanaWalletProvider wallets={wallets} autoConnect>{children}</SolanaWalletProvider></ConnectionProvider></SolanaDeploymentNetworkContext.Provider></QueryClientProvider></WagmiProvider>
}
