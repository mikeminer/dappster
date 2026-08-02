import { AuditTool } from "@/components/AuditTool"

export const metadata = { title: "Smart Contract Audit — Dappster" }

export default function AuditPage() { return <><section className="page-hero"><div className="container"><div className="section-label">{"// Security scanner"}</div><h1>Find the flaw before they do.</h1><p>Deep AI-assisted review for Solidity and Solana programs, with prioritized findings and actionable fixes.</p></div></section><section className="app-section"><div className="container"><AuditTool /></div></section></> }
