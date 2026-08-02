import { PromptBuilder } from "@/components/PromptBuilder"

export const metadata = { title: "AI dApp Builder — Dappster" }

export default function BuildPage() {
  return <><section className="page-hero"><div className="container"><div className="section-label">{"// AI builder"}</div><h1>Build the protocol.</h1><p>Generate smart-contract source and a complete React interface for EVM, Solana, Move, CosmWasm, TON, NEAR, Starknet and Algorand.</p></div></section><section className="app-section"><div className="container"><PromptBuilder /></div></section></>
}
