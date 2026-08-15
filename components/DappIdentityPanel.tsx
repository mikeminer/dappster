"use client"

import { useState } from "react"
import { CheckCircle2, ExternalLink, Fingerprint, Loader2 } from "lucide-react"
import { createPublicClient } from "viem"
import { apiFetch } from "@/lib/client-api"
import { getConnectedEvmWallet } from "@/lib/connected-evm-wallet"
import { base, getEvmTransport } from "@/lib/evm-chains"
import { DAPPSTER_IDENTITY_REGISTRY_ABI, type PreparedRelease } from "@/lib/identity-registry"

export type ConfirmedRelease = {
  release_id: string
  registry_dapp_id: string
  release_version: number | string
  registry_address: string
  registry_tx_hash: string
  manifest_hash: string
  manifest_cid: string
  manifest_url: string
  runtime_code_hash: string
  source_hash: string
  frontend_cid_hash: string
  audit_report_hash: string
  audit_score: number
  confirmed_at: string
}

type Props = {
  dappId: string
  isOwner: boolean
  chain: string
  chainId?: number
  contractAddress?: string
  ipfsHash?: string
  auditReady: boolean
  release?: ConfirmedRelease | null
  onConfirmed: () => Promise<void>
}

function shortHash(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

export function DappIdentityPanel(props: Props) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [stage, setStage] = useState("")

  async function anchorRelease() {
    try {
      setWorking(true)
      setError("")
      setStage("Preparing and pinning the canonical manifest…")
      const { address, wallet } = await getConnectedEvmWallet(base)
      const prepared = await apiFetch<PreparedRelease>("/api/identity/prepare", {
        method: "POST",
        body: JSON.stringify({ dappId: props.dappId, publisher: address }),
      })
      setStage("Confirm the immutable Base registry transaction…")
      const hash = await wallet.writeContract({
        account: address,
        address: prepared.registryAddress,
        abi: DAPPSTER_IDENTITY_REGISTRY_ABI,
        functionName: "registerRelease",
        args: [{
          contractAddress: prepared.input.contractAddress,
          creationCodeHash: prepared.input.creationCodeHash,
          runtimeCodeHash: prepared.input.runtimeCodeHash,
          sourceHash: prepared.input.sourceHash,
          frontendCidHash: prepared.input.frontendCidHash,
          auditReportHash: prepared.input.auditReportHash,
          manifestHash: prepared.input.manifestHash,
          auditScore: prepared.input.auditScore,
          deploymentBlock: BigInt(prepared.input.deploymentBlock),
          manifestCid: prepared.input.manifestCid,
        }],
      })
      setStage("Verifying the registry receipt…")
      const receipt = await createPublicClient({ chain: base, transport: getEvmTransport(base) })
        .waitForTransactionReceipt({ hash, confirmations: 1 })
      if (receipt.status !== "success") throw new Error("The registry transaction failed")
      await apiFetch("/api/identity/confirm", {
        method: "POST",
        body: JSON.stringify({ preparedId: prepared.preparedId, txHash: hash }),
      })
      setStage("Release verified on Base")
      await props.onConfirmed()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not anchor this release")
      setStage("")
    } finally {
      setWorking(false)
    }
  }

  const eligible = props.chain === "evm" && props.chainId === base.id && Boolean(props.contractAddress && props.ipfsHash && props.auditReady)
  const release = props.release

  return <section className="panel">
    <div className="panel-head">
      <span className="panel-title"><Fingerprint size={15} /> Verifiable release identity</span>
      <span className="chain-badge">Base registry</span>
    </div>
    <div className="panel-body form-stack">
      {release ? <>
        <div className="trust-line"><CheckCircle2 size={18} /><div><strong>Immutable release v{release.release_version}</strong><small>Contract bytecode, frontend CID and audit hash are bound in one Base record.</small></div></div>
        <dl className="identity-proof-list">
          <div><dt>Release ID</dt><dd className="mono" title={release.release_id}>{shortHash(release.release_id)}</dd></div>
          <div><dt>Manifest</dt><dd className="mono" title={release.manifest_hash}>{shortHash(release.manifest_hash)}</dd></div>
          <div><dt>Runtime</dt><dd className="mono" title={release.runtime_code_hash}>{shortHash(release.runtime_code_hash)}</dd></div>
          <div><dt>Audit score</dt><dd>{release.audit_score}/100</dd></div>
        </dl>
        <div className="button-row">
          <a className="btn btn-outline" href={`/verify/${release.release_id}`}>Verify release <ExternalLink size={14} /></a>
          <a className="btn btn-outline" href={release.manifest_url} target="_blank" rel="noreferrer">Manifest on IPFS <ExternalLink size={14} /></a>
          <a className="btn btn-outline" href={`https://basescan.org/tx/${release.registry_tx_hash}`} target="_blank" rel="noreferrer">Base proof <ExternalLink size={14} /></a>
        </div>
      </> : <>
        <p className="detail-note">Create an append-only proof that binds the deployed Base bytecode, IPFS frontend and exact audit report.</p>
        {props.isOwner && eligible && <button className="btn btn-primary btn-block" type="button" onClick={anchorRelease} disabled={working}>
          {working ? <Loader2 className="animate-spin" size={15} /> : <Fingerprint size={15} />}
          {stage || "Anchor verified release on Base"}
        </button>}
        {props.isOwner && !eligible && <div className="mode-notice">A Base deployment, live IPFS frontend and completed audit are required. Other chains will be enabled only with a verifiable cross-chain proof.</div>}
        {!props.isOwner && <div className="mode-notice">This release has not been anchored in the Dappster Base registry.</div>}
      </>}
      {error && <div className="error-box">{error}</div>}
    </div>
  </section>
}
