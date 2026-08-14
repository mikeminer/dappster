"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, ChevronDown, Code2, Download, ExternalLink, FileCode2, Loader2, Rocket, Save, ShieldCheck, Store } from "lucide-react"
import { apiFetch } from "@/lib/client-api"
import { burnCreditsFromUserWallet, clearPendingCreditBurn } from "@/lib/client-credit-burn"
import { featuredDapps } from "@/lib/mock-data"
import { resolveIpfsUrl } from "@/lib/ipfs"
import { getSupportedEvmChain } from "@/lib/evm-chains"
import { MarketplacePurchaseButton } from "@/components/MarketplacePurchaseButton"
import { FastDeployPanel } from "@/components/FastDeployPanel"
import { SocialShare } from "@/components/SocialShare"
import { ChainNetworkBadge } from "@/components/ChainNetworkBadge"
import type { AssetVisibility, MarketplaceAsset } from "@/lib/marketplace"
import type { AuditReport, Chain } from "@/types"
import { getChainAdapter } from "@/lib/chain-adapters"

type AssetAccess = { visibility: AssetVisibility; price: number; unlocked: boolean; purchased: boolean }
type Detail = {
  id: string
  name: string
  description?: string
  chain: Chain
  tags?: string[]
  owner_id?: string
  publisher_name?: string
  publisher_username?: string | null
  publisher_points?: number
  contract_address?: string
  contract_tx_hash?: string
  contract_chain_id?: number
  contract_network?: "devnet" | "mainnet-beta"
  deploy_status?: string
  ipfs_hash?: string
  ipfs_url?: string
  app_visibility?: boolean
  audit_status?: string
  is_featured?: boolean
  contract_code?: string
  frontend_code?: string
  audit_report?: AuditReport
  audit_created_at?: string
  base_payout_address?: string | null
  solana_payout_address?: string | null
  marketplace?: Record<MarketplaceAsset, AssetAccess>
  viewer?: { isOwner: boolean; authenticated: boolean }
}

function safeFileStem(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 64) || "DappsterContract"
}

function downloadSourceFile(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function buildDeployReadme(dapp: Detail, contractFilename: string, ipfsUrl?: string) {
  const feeSymbol = dapp.contract_chain_id
    ? getSupportedEvmChain(dapp.contract_chain_id)?.nativeCurrency.symbol || "native token"
    : "native token"
  const network = dapp.chain === "solana"
    ? `Solana ${dapp.contract_network || "network selected by the publisher"}`
    : dapp.chain === "evm" ? dapp.contract_chain_id ? `EVM chain ID ${dapp.contract_chain_id}` : "EVM network selected by the publisher"
      : `${getChainAdapter(dapp.chain).name} network selected by the publisher`
  return `# ${dapp.name} — Deployment

## Project files

- \`${contractFilename}\` — onchain program source
- \`App.tsx\` — frontend source
- \`Deploy.md\` — this deployment manifest

## Published deployment

- Network: ${network}
- Contract / Program: ${dapp.contract_address || "Not deployed"}
- Transaction: ${dapp.contract_tx_hash || "Not recorded"}
- Frontend: ${ipfsUrl || "Not published to IPFS"}
- Status: ${dapp.deploy_status || "draft"}

## Deploy your own copy

1. Review the complete onchain source and App.tsx before signing anything.
2. Open this listing's Fast Deploy offer, when enabled by the publisher.
3. Connect the wallet that will own and fund the deployment.
4. Select the target network and confirm the wallet transaction.
5. Verify the resulting address on the network explorer before using the app.

${dapp.chain === "evm" ? `EVM deployments require native gas and include the Dappster 0.001 ${feeSymbol} deployment fee in the contract-creation transaction.` : "Solana deployments require the user to fund the exact rent and network fees quoted by Dappster."}
`
}

const assets: Array<{ id: MarketplaceAsset; title: string; description: string }> = [
  { id: "frontend", title: "Frontend source code", description: "Inspect and reuse the generated App.tsx source code." },
  { id: "source", title: "Smart contract source", description: "Review and download the original generated source code." },
  { id: "audit", title: "Security audit", description: "Read the complete AI security report and findings." },
  { id: "deploy", title: "Fast deployment", description: "Let buyers create and deploy their own private copy from Builder." },
]

export function DappDetailClient({ id }: { id: string }) {
  const [dapp, setDapp] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [auditing, setAuditing] = useState(false)
  const [settings, setSettings] = useState<Record<MarketplaceAsset, { visibility: AssetVisibility; price: number }> | null>(null)
  const [payouts, setPayouts] = useState({ base: "", solana: "" })
  const [appVisible, setAppVisible] = useState(true)

  const load = useCallback(async () => {
    const payload = await apiFetch<Detail>(`/api/dapps/${id}`)
    setDapp(payload)
    if (payload.marketplace) setSettings(Object.fromEntries(assets.map(asset => [asset.id, { visibility: payload.marketplace![asset.id].visibility, price: payload.marketplace![asset.id].price }])) as Record<MarketplaceAsset, { visibility: AssetVisibility; price: number }>)
    if (payload.viewer?.isOwner) {
      setPayouts({ base: payload.base_payout_address || "", solana: payload.solana_payout_address || "" })
      setAppVisible(payload.app_visibility !== false)
    }
  }, [id])

  useEffect(() => {
    load().catch(cause => {
      const sample = featuredDapps.find(item => item.id === id)
      if (sample) setDapp({ ...sample, tags: sample.tags, is_featured: sample.isFeatured })
      else setError(cause instanceof Error ? cause.message : "dApp not found")
    }).finally(() => setLoading(false))
  }, [id, load])

  async function saveMarketplace() {
    if (!settings) return
    try {
      setSaving(true)
      setError("")
      await apiFetch(`/api/dapps/${id}`, { method: "PATCH", body: JSON.stringify({
        source_visibility: settings.source.visibility,
        frontend_visibility: settings.frontend.visibility,
        audit_visibility: settings.audit.visibility,
        deploy_visibility: settings.deploy.visibility,
        source_price_usdc: settings.source.price,
        frontend_price_usdc: settings.frontend.price,
        audit_price_usdc: settings.audit.price,
        deploy_price_usdc: settings.deploy.price,
        app_visibility: appVisible,
        base_payout_address: payouts.base.trim() || null,
        solana_payout_address: payouts.solana.trim() || null,
      }) })
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save marketplace settings") }
    finally { setSaving(false) }
  }

  async function auditDeployedContract() {
    if (!dapp?.contract_code || !dapp.contract_address) return
    try {
      setAuditing(true)
      setError("")
      const creditBurn = await burnCreditsFromUserWallet(25, `${dapp.chain} premium deployed-contract audit`)
      await apiFetch("/api/audit", { method: "POST", body: JSON.stringify({ dappId: dapp.id, contractCode: dapp.contract_code, chain: dapp.chain, tier: "premium", creditBurn }) })
      clearPendingCreditBurn(creditBurn)
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Audit failed") }
    finally { setAuditing(false) }
  }

  if (loading) return <div className="empty-state"><Loader2 className="animate-spin" /></div>
  if (!dapp) return <div className="empty-state"><div><strong>{error || "dApp not found"}</strong><p><Link href="/explore">Return to Marketplace</Link></p></div></div>
  const owner = dapp.publisher_name || (dapp.owner_id ? `${dapp.owner_id.slice(0, 6)}…${dapp.owner_id.slice(-4)}` : "Dappster builder")
  const ipfsUrl = resolveIpfsUrl(dapp.ipfs_hash, dapp.ipfs_url)
  const contractFilename = dapp.chain === "evm" ? `${safeFileStem(dapp.name)}.sol` : getChainAdapter(dapp.chain).sourceFile
  const deployReadme = buildDeployReadme(dapp, contractFilename, ipfsUrl)

  function lockedAsset(asset: MarketplaceAsset) {
    const access = dapp?.marketplace?.[asset]
    if (!access || access.unlocked) return null
    return <div className="locked-asset"><Store size={22} /><strong>{access.visibility === "paid" ? `Unlock ${asset}` : `${asset} is private`}</strong><p>{access.visibility === "paid" ? "Purchase permanent access. 90% of the payment goes directly to the creator." : "The creator has not made this content available."}</p>{access.visibility === "paid" && <MarketplacePurchaseButton dappId={dapp!.id} asset={asset} price={access.price} />}</div>
  }

  return <>
    <section className="page-hero"><div className="container"><Link href="/explore" className="back-link"><ArrowLeft size={14} /> Back to Marketplace</Link><div className="detail-title"><div className="dapp-icon accent-blue">{dapp.name.slice(0, 1).toUpperCase()}</div><div><div className="title-row"><h1>{dapp.name}</h1>{dapp.is_featured && <span className="eyebrow">Featured</span>}<SocialShare dappId={dapp.id} dappName={dapp.name} /></div><div className="tags"><ChainNetworkBadge chain={dapp.chain} chainId={dapp.contract_chain_id} contractNetwork={dapp.contract_network} />{(dapp.tags || []).map(tag => <span className="tag" key={tag}>{tag}</span>)}</div></div></div></div></section>
    <section className="app-section"><div className="container form-stack">
      {error && <div className="error-box">{error}</div>}
      <div className="audit-layout"><div className="form-stack">
        <section className="panel"><div className="panel-head"><span className="panel-title">About this dApp</span><span className="points-pill">{dapp.publisher_points || 0} pts</span></div><div className="panel-body"><p className="detail-copy">{dapp.description || "An onchain application generated with Dappster."}</p><p className="detail-note">Published by {dapp.publisher_username ? <Link href={`/creator/${encodeURIComponent(dapp.publisher_username)}`}>{owner}</Link> : owner}. Verify the contract address before interacting with any onchain application.</p></div></section>
        <details className="panel collapsible-panel"><summary className="panel-head"><span className="panel-title"><FileCode2 size={15} /> {contractFilename}</span><span className="collapsible-panel-status">{dapp.marketplace?.source.unlocked && <span className="status"><span className="status-dot" /> Available</span>}<ChevronDown className="collapsible-chevron" size={17} aria-hidden="true" /></span></summary>{dapp.contract_code ? <><div className="source-file-toolbar"><span>Smart contract source</span><button className="btn btn-ghost" type="button" onClick={() => downloadSourceFile(contractFilename, dapp.contract_code!)}><Download size={14} /> Download</button></div><pre className="marketplace-code">{dapp.contract_code}</pre></> : lockedAsset("source") || <div className="panel-body mode-notice">No source code is stored for this project.</div>}</details>
        <details className="panel collapsible-panel"><summary className="panel-head"><span className="panel-title"><FileCode2 size={15} /> App.tsx</span><span className="collapsible-panel-status">{dapp.marketplace?.frontend.unlocked && <span className="status"><span className="status-dot" /> Available</span>}<ChevronDown className="collapsible-chevron" size={17} aria-hidden="true" /></span></summary>{dapp.frontend_code ? <><div className="source-file-toolbar"><span>Frontend source</span><button className="btn btn-ghost" type="button" onClick={() => downloadSourceFile("App.tsx", dapp.frontend_code!)}><Download size={14} /> Download</button></div><pre className="marketplace-code">{dapp.frontend_code}</pre></> : lockedAsset("frontend") || <div className="panel-body mode-notice">No frontend source code is stored for this project.</div>}</details>
        <details className="panel collapsible-panel"><summary className="panel-head"><span className="panel-title"><FileCode2 size={15} /> Deploy.md</span><span className="collapsible-panel-status"><span className="status"><span className="status-dot" /> Available</span><ChevronDown className="collapsible-chevron" size={17} aria-hidden="true" /></span></summary><div className="source-file-toolbar"><span>Verified deployment manifest</span><button className="btn btn-ghost" type="button" onClick={() => downloadSourceFile("Deploy.md", deployReadme)}><Download size={14} /> Download</button></div><pre className="marketplace-code">{deployReadme}</pre></details>
        <details className="panel collapsible-panel"><summary className="panel-head"><span className="panel-title">Security audit</span><span className="collapsible-panel-status">{dapp.audit_report && <span className="status"><ShieldCheck size={14} /> Score {dapp.audit_report.overall_score}/100</span>}<ChevronDown className="collapsible-chevron" size={17} aria-hidden="true" /></span></summary>{dapp.audit_report ? <div className="panel-body"><p className="detail-copy">{dapp.audit_report.summary}</p><div className="finding-list">{dapp.audit_report.findings.map(finding => <article className="finding" key={finding.id}><span className="chain-badge">{finding.severity}</span><h3>{finding.title}</h3><p>{finding.description}</p><dl><div><dt>Impact</dt><dd>{finding.impact}</dd></div><div><dt>Fix</dt><dd>{finding.recommendation}</dd></div></dl></article>)}</div></div> : lockedAsset("audit") || <div className="panel-body mode-notice">No completed audit is available.</div>}</details>
      </div><aside className="form-stack">
        <section className="panel"><div className="panel-head"><span className="panel-title">Launch</span>{ipfsUrl && <span className="status"><span className="status-dot" /> Live</span>}</div><div className="panel-body form-stack">{ipfsUrl ? <a href={ipfsUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-block">Open dApp <ExternalLink size={15} /></a> : <div className="mode-notice">{dapp.app_visibility === false ? "The creator has hidden the live IPFS app." : "This frontend has not been deployed to IPFS."}</div>}{dapp.viewer?.isOwner && !ipfsUrl && dapp.contract_code && dapp.frontend_code && <Link href={`/build?project=${encodeURIComponent(dapp.id)}`} className="btn btn-primary btn-block"><Rocket size={15} />{dapp.contract_address ? "Publish frontend to IPFS" : getChainAdapter(dapp.chain).deploymentReady ? `Deploy ${getChainAdapter(dapp.chain).contractNoun.toLowerCase()} + frontend` : `Open ${getChainAdapter(dapp.chain).name} source preview`}</Link>}<div><label className="form-label">Onchain identifier</label><div className="input mono detail-value">{dapp.contract_address || "Not deployed onchain"}</div></div></div></section>
        {!dapp.viewer?.isOwner && dapp.marketplace?.deploy && <FastDeployPanel dappId={dapp.id} chain={dapp.chain} access={dapp.marketplace.deploy} />}
        {dapp.viewer?.isOwner && <><section className="panel"><div className="panel-head"><span className="panel-title">Deployed-contract audit</span><span className="chain-badge">25 credits</span></div><div className="panel-body form-stack"><p className="detail-note">Run a fresh premium audit against the exact source associated with this deployed address.</p><button className="btn btn-outline btn-block" type="button" disabled={auditing || !dapp.contract_address || !dapp.contract_code} onClick={auditDeployedContract}>{auditing ? <Loader2 className="animate-spin" size={15} /> : <ShieldCheck size={15} />}{auditing ? "Auditing deployed contract..." : dapp.audit_report ? "Run audit again" : "Audit deployed contract"}</button></div></section>
        <section className="panel"><div className="panel-head"><span className="panel-title">Creator marketplace</span><span className="chain-badge">90% creator revenue</span></div><div className="panel-body form-stack"><p className="detail-note">Choose what visitors can access. Paid purchases are permanent and verified in USDC.</p><div className="marketplace-setting"><div><strong>Live app on IPFS</strong><small>Show or hide the launch link independently from the frontend source code.</small></div><button type="button" role="switch" aria-checked={appVisible} className={`visibility-toggle ${appVisible ? "active" : ""}`} onClick={() => setAppVisible(value => !value)}><span>{appVisible ? "Viewable" : "Hidden"}</span><i aria-hidden="true" /></button></div><div><label className="form-label" htmlFor="base-payout">Base payout address</label><input id="base-payout" className="input mono" value={payouts.base} onChange={event => setPayouts(current => ({ ...current, base: event.target.value }))} placeholder="0x…" /></div><div><label className="form-label" htmlFor="solana-payout">Solana payout address</label><input id="solana-payout" className="input mono" value={payouts.solana} onChange={event => setPayouts(current => ({ ...current, solana: event.target.value }))} placeholder="Base58 address" /></div>{settings && assets.map(asset => <div className="marketplace-setting" key={asset.id}><div><strong>{asset.title}</strong><small>{asset.description}</small></div><select className="select" aria-label={`${asset.title} visibility`} value={settings[asset.id].visibility} onChange={event => setSettings(current => current ? { ...current, [asset.id]: { ...current[asset.id], visibility: event.target.value as AssetVisibility } } : current)}><option value="private">Private</option><option value="free">Free</option><option value="paid">Paid</option></select>{settings[asset.id].visibility === "paid" && <label><span>Price</span><input className="input" aria-label={`${asset.title} price in USDC`} type="number" min="1" max="10000" step="0.01" value={settings[asset.id].price} onChange={event => setSettings(current => current ? { ...current, [asset.id]: { ...current[asset.id], price: Number(event.target.value) } } : current)} /><em>USDC</em></label>}</div>)}<button className="btn btn-primary btn-block" type="button" disabled={saving} onClick={saveMarketplace}>{saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}{saving ? "Saving..." : "Save marketplace settings"}</button></div></section></>}
        <section className="panel"><div className="panel-body trust-line"><Code2 size={18} /><div><strong>Onchain verification</strong><small>The contract address remains public. Source, frontend, and audit access are controlled independently.</small></div></div></section>
      </aside></div>
    </div></section>
  </>
}
