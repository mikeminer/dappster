"use client"

import { useState } from "react"
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react"
import { apiFetch } from "@/lib/client-api"
import { burnCreditsFromUserWallet, clearPendingCreditBurn } from "@/lib/client-credit-burn"
import type { AuditReport, Chain } from "@/types"

const severityColor = { critical: "#ff5757", high: "#ff8b4a", medium: "#e4c348", low: "#65a5ff", info: "#aeb4bc" }

export function AuditTool() {
  const [code, setCode] = useState("")
  const [chain, setChain] = useState<Chain>("evm")
  const [tier, setTier] = useState<"basic" | "premium">("premium")
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<AuditReport | null>(null)
  const [credits, setCredits] = useState<number | null>(null)
  const [error, setError] = useState("")

  async function audit() {
    if (!code.trim()) return
    setLoading(true)
    setError("")
    try {
      const cost = tier === "premium" ? 25 : 15
      const creditBurn = await burnCreditsFromUserWallet(cost, `${tier} security audit`)
      const output = await apiFetch<{ report: AuditReport; creditsRemaining: number }>("/api/audit", { method: "POST", body: JSON.stringify({ contractCode: code, chain, tier, creditBurn }) })
      clearPendingCreditBurn(creditBurn)
      setReport(output.report)
      setCredits(output.creditsRemaining)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Audit failed")
    } finally {
      setLoading(false)
    }
  }

  return <div className="audit-layout"><section className="panel"><div className="panel-head"><span className="panel-title">Contract source</span><span className="chain-badge">{tier === "premium" ? 25 : 15} credits</span></div><div className="panel-body form-stack"><div><label className="form-label">Network</label><div className="segmented"><button className={`segment ${chain === "evm" ? "active" : ""}`} onClick={() => setChain("evm")}>◆ Solidity / EVM</button><button className={`segment ${chain === "solana" ? "active" : ""}`} onClick={() => setChain("solana")}>≋ Rust / Solana</button></div></div><div><label className="form-label">Audit depth</label><div className="segmented"><button className={`segment ${tier === "basic" ? "active" : ""}`} onClick={() => setTier("basic")}>Basic · 15</button><button className={`segment ${tier === "premium" ? "active" : ""}`} onClick={() => setTier("premium")}>Premium · 25</button></div></div><div><label className="form-label" htmlFor="code">Paste your contract</label><textarea id="code" className="textarea mono" style={{minHeight:330,fontSize:12}} value={code} onChange={event => setCode(event.target.value)} placeholder={chain === "evm" ? "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;" : "use anchor_lang::prelude::*;"} /></div>{error && <div className="error-box"><AlertCircle size={15} /><span>{error}</span></div>}<button className="btn btn-primary btn-block" onClick={audit} disabled={!code.trim() || loading}>{loading ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}{loading ? "Claude is auditing every path..." : "Run security audit"}</button></div></section><section className="panel"><div className="panel-head"><span className="panel-title">Security report</span>{report && <span className="status"><span className="status-dot" /> Complete{credits !== null ? ` · ${credits} credits left` : ""}</span>}</div>{report ? <div className="panel-body"><div className="score-ring" style={{background:`conic-gradient(${report.passed ? "#c7ff32" : "#ff8b4a"} 0 ${report.overall_score}%, #24292f ${report.overall_score}%)`}}><span>{report.overall_score}<small>/100</small></span></div><p style={{color:"#929aa4",fontSize:12,lineHeight:1.65,textAlign:"center",margin:"0 auto 22px",maxWidth:480}}>{report.summary}</p><div className="severity-row">{(["critical","high","medium","low","info"] as const).map(severity => <div className="severity" key={severity}><strong style={{color:severityColor[severity]}}>{report.severity_counts[severity]}</strong><span>{severity}</span></div>)}</div><div className="finding-list">{report.findings.map(finding => <article className="finding" key={finding.id}><div style={{display:"flex",justifyContent:"space-between",gap:12}}><span className="chain-badge" style={{color:severityColor[finding.severity]}}>{finding.severity}</span><span className="mono" style={{color:"#5f6771",fontSize:10}}>{finding.id}</span></div><h3>{finding.title}</h3><p>{finding.description}</p><dl><div><dt>Location</dt><dd>{finding.location}</dd></div><div><dt>Impact</dt><dd>{finding.impact}</dd></div><div><dt>Fix</dt><dd>{finding.recommendation}</dd></div></dl>{finding.fix && <pre className="finding-code">{finding.fix}</pre>}</article>)}</div><p className="audit-disclaimer">This AI audit is not a replacement for a professional human security audit. Always review code manually before deploying to mainnet.</p></div> : <div className="empty-state"><div><div className="empty-icon"><ShieldCheck size={24} /></div><strong style={{color:"#abb1b9",fontSize:14}}>No report yet</strong><p style={{fontSize:12,maxWidth:310,lineHeight:1.6}}>Submit contract code for a deep vulnerability analysis and precise remediation plan.</p></div></div>}</section></div>
}
