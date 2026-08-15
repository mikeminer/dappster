import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, CheckCircle2, ExternalLink, Fingerprint } from "lucide-react"
import { supabaseRequest } from "@/lib/supabase"

type Release = {
  release_id: string
  registry_dapp_id: string
  release_version: string | number
  publisher_address: string
  contract_address: string
  deployment_tx_hash: string
  creation_code_hash: string
  runtime_code_hash: string
  source_hash: string
  frontend_cid_hash: string
  audit_report_hash: string
  manifest_hash: string
  manifest_cid: string
  manifest_url: string
  audit_score: number
  registry_address: string
  registry_tx_hash: string
  registered_block: string | number
  confirmed_at: string
}

export default async function VerifyReleasePage({ params }: { params: Promise<{ releaseId: string }> }) {
  const { releaseId } = await params
  if (!/^0x[0-9a-fA-F]{64}$/.test(releaseId)) notFound()
  const release = (await supabaseRequest<Release[]>({
    path: "dapp_releases",
    query: { release_id: `eq.${releaseId}`, status: "eq.confirmed", select: "*", limit: "1" },
  }).catch(() => []))[0]
  if (!release) notFound()

  const proofs = [
    ["Release ID", release.release_id],
    ["Registry dApp ID", release.registry_dapp_id],
    ["Creation code hash", release.creation_code_hash],
    ["Runtime code hash", release.runtime_code_hash],
    ["Solidity source hash", release.source_hash],
    ["Frontend CID hash", release.frontend_cid_hash],
    ["Audit report hash", release.audit_report_hash],
    ["Canonical manifest hash", release.manifest_hash],
  ]

  return <main>
    <section className="page-hero"><div className="container"><Link href="/explore" className="back-link"><ArrowLeft size={14} /> Marketplace</Link><div className="detail-title"><div className="dapp-icon accent-green"><Fingerprint /></div><div><h1>Verified release</h1><p className="detail-note">An immutable Dappster release bundle anchored on Base.</p></div></div></div></section>
    <section className="app-section"><div className="container"><section className="panel" style={{ maxWidth: 920, margin: "0 auto" }}>
      <div className="panel-head"><span className="panel-title"><CheckCircle2 size={16} /> Base release v{release.release_version}</span><span className="status"><span className="status-dot" /> Confirmed</span></div>
      <div className="panel-body form-stack">
        <dl className="identity-proof-list">
          <div><dt>Publisher</dt><dd className="mono">{release.publisher_address}</dd></div>
          <div><dt>Contract</dt><dd className="mono">{release.contract_address}</dd></div>
          <div><dt>Audit score</dt><dd>{release.audit_score}/100</dd></div>
          <div><dt>Base block</dt><dd>{release.registered_block}</dd></div>
          {proofs.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mono" title={value}>{value}</dd></div>)}
        </dl>
        <div className="button-row">
          <a className="btn btn-primary" href={release.manifest_url} target="_blank" rel="noreferrer">Open canonical manifest <ExternalLink size={14} /></a>
          <a className="btn btn-outline" href={`https://basescan.org/tx/${release.registry_tx_hash}`} target="_blank" rel="noreferrer">Verify transaction <ExternalLink size={14} /></a>
          <a className="btn btn-outline" href={`https://basescan.org/address/${release.registry_address}`} target="_blank" rel="noreferrer">Inspect registry <ExternalLink size={14} /></a>
        </div>
      </div>
    </section></div></section>
  </main>
}
