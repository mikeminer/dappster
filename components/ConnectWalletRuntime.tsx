"use client"

import { ConnectButton } from "@/components/ConnectButton"
import { EvmSolanaProviders } from "@/components/WalletProvider"

export function ConnectWalletRuntime(props: {
  mode?: "button" | "panel"
  redirectTo?: string
  controlledOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return <EvmSolanaProviders><ConnectButton {...props} /></EvmSolanaProviders>
}
