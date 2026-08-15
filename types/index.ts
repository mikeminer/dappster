export type Chain = "evm" | "solana" | "sui" | "aptos" | "cosmos" | "ton" | "near" | "starknet" | "algorand"

export interface Dapp {
  id: string
  name: string
  description: string
  chain: Chain
  chainId?: number | null
  network?: string | null
  tags: string[]
  owner: string
  icon: string
  accent: string
  isFeatured?: boolean
  status?: "live" | "draft" | "deploying"
  createdAt?: string
  contractCode?: string
  frontendCode?: string
  ipfsUrl?: string
  contractAddress?: string
}

export interface AuditFinding {
  id: string
  severity: "critical" | "high" | "medium" | "low" | "info"
  title: string
  description: string
  location: string
  impact: string
  recommendation: string
  fix?: string
}

export interface AuditReport {
  summary: string
  severity_counts: Record<AuditFinding["severity"], number>
  findings: AuditFinding[]
  gas_optimizations: { title: string; savings_estimate: string; fix: string }[]
  overall_score: number
  passed: boolean
}
