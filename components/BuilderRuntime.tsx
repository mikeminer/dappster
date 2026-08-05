"use client"

import { PromptBuilder } from "@/components/PromptBuilder"
import { Web3Providers } from "@/components/WalletProvider"

export function BuilderRuntime() {
  return <Web3Providers><PromptBuilder /></Web3Providers>
}
