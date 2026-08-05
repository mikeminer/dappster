"use client"

import { ConnectButton } from "@/components/ConnectButton"
import { EvmSolanaProviders } from "@/components/WalletProvider"

export function ConnectWalletRuntime(props: { mode?: "button" | "panel"; redirectTo?: string }) {
  return <EvmSolanaProviders><ConnectButton {...props} /></EvmSolanaProviders>
}
