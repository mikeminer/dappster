import { BuilderIsland } from "@/components/BuilderIsland"

export const metadata = { title: "AI dApp Builder — Dappster" }
export const dynamic = "force-dynamic"

export default function BuildPage() {
  return <><section className="page-hero"><div className="container"><div className="section-label">{"// AI builder"}</div><h1>Build the protocol.</h1><p>Generate smart-contract source and a complete React interface for EVM, Solana, Move, CosmWasm, TON, NEAR, Starknet and Algorand.</p></div></section><section className="app-section"><div className="container"><BuilderIsland /></div></section></>
}
