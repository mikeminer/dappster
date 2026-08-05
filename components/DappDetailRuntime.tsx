"use client"

import { DappDetailClient } from "@/components/DappDetailClient"
import { EvmSolanaProviders } from "@/components/WalletProvider"

export function DappDetailRuntime({ id }: { id: string }) {
  return <EvmSolanaProviders><DappDetailClient id={id} /></EvmSolanaProviders>
}
