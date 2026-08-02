"use client"

import { createAppKit } from "@reown/appkit/react"
import type { AppKitNetwork } from "@reown/appkit/networks"
import { solana, solanaDevnet } from "@reown/appkit/networks"
import { SolanaAdapter } from "@reown/appkit-adapter-solana/react"
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi"
import { http } from "wagmi"
import { SUPPORTED_EVM_CHAINS } from "@/lib/evm-chains"

export const reownProjectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim() || ""
export const reownEnabled = Boolean(reownProjectId)

const metadata = {
  name: "Dappster",
  description: "Build, deploy and discover onchain applications.",
  url: "https://dappster.fun",
  icons: ["https://dappster.fun/icon.svg"],
  redirect: {
    universal: "https://dappster.fun/login",
  },
}

const evmNetworks = [...SUPPORTED_EVM_CHAINS] as unknown as [AppKitNetwork, ...AppKitNetwork[]]

export const wagmiAdapter = new WagmiAdapter({
  networks: evmNetworks,
  projectId: reownProjectId,
  ssr: true,
  transports: Object.fromEntries(SUPPORTED_EVM_CHAINS.map(network => [network.id, http(network.rpcUrls.default.http[0])])),
})

export const wagmiConfig = wagmiAdapter.wagmiConfig

// A single AppKit instance owns both EVM and Solana WalletConnect sessions.
// This is required for reliable mobile deep links and session restoration.
export const reownAppKit = reownEnabled && typeof window !== "undefined"
  ? createAppKit({
      adapters: [wagmiAdapter, new SolanaAdapter({ registerWalletStandard: true })],
      networks: [...evmNetworks, solana, solanaDevnet] as [AppKitNetwork, ...AppKitNetwork[]],
      defaultNetwork: evmNetworks[0],
      metadata,
      projectId: reownProjectId,
      features: {
        analytics: true,
        email: false,
        socials: false,
      },
    })
  : null
