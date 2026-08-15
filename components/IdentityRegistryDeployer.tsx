"use client"

import { useState } from "react"
import { Check, ExternalLink, Loader2, Rocket } from "lucide-react"
import { createPublicClient, type Abi } from "viem"
import { apiFetch } from "@/lib/client-api"
import { getConnectedEvmWallet } from "@/lib/connected-evm-wallet"
import { base, getEvmTransport } from "@/lib/evm-chains"

const OWNER = "0x5d69c42a3a481d0ccfd88cfa8a2a08e2bf456134"
type Artifact = { abi: Abi; bytecode: `0x${string}` }

export function IdentityRegistryDeployer() {
  const [stage, setStage] = useState("")
  const [address, setAddress] = useState<`0x${string}` | "">("")
  const [txHash, setTxHash] = useState<`0x${string}` | "">("")
  const [error, setError] = useState("")

  async function deploy() {
    try {
      setError("")
      setStage("Compiling the append-only registry…")
      const artifact = await apiFetch<Artifact>("/api/admin/identity-registry-artifact")
      const { address: account, wallet } = await getConnectedEvmWallet(base, [OWNER])
      if (account.toLowerCase() !== OWNER) throw new Error(`Connect the owner wallet ${OWNER}`)
      setStage("Confirm the Base deployment in your wallet…")
      const hash = await wallet.deployContract({ account, abi: artifact.abi, bytecode: artifact.bytecode })
      setTxHash(hash)
      setStage("Waiting for Base confirmation…")
      const receipt = await createPublicClient({ chain: base, transport: getEvmTransport(base) })
        .waitForTransactionReceipt({ hash, confirmations: 1 })
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("The registry deployment failed")
      setAddress(receipt.contractAddress)
      setStage("Registry deployed")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Registry deployment failed")
      setStage("")
    }
  }

  return <section className="panel" style={{ maxWidth: 760, margin: "0 auto" }}>
    <div className="panel-head"><span className="panel-title">Dappster identity registry</span><span className="chain-badge">Base · 8453</span></div>
    <div className="panel-body form-stack">
      <p className="detail-note">Deploy the non-upgradeable append-only registry. It verifies Base runtime bytecode and binds it to a frontend CID and audit hash.</p>
      {error && <div className="error-box">{error}</div>}
      {address ? <>
        <div className="deploy-result"><div><span className="status"><span className="status-dot" /> Registry deployed</span><div className="mono">{address}</div></div><a className="btn btn-outline" href={`https://basescan.org/address/${address}`} target="_blank" rel="noreferrer">BaseScan <ExternalLink size={14} /></a></div>
        <div className="mode-notice">Set <span className="mono">NEXT_PUBLIC_DAPPSTER_IDENTITY_REGISTRY_ADDRESS={address}</span> in Vercel, apply the Supabase migration, then redeploy Dappster.</div>
      </> : <button className="btn btn-primary btn-block" type="button" onClick={deploy} disabled={Boolean(stage)}>{stage ? <Loader2 className="animate-spin" size={16} /> : <Rocket size={16} />}{stage || "Deploy identity registry"}</button>}
      {txHash && <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer" className="btn btn-ghost"><Check size={14} /> Transaction {txHash.slice(0, 10)}…</a>}
    </div>
  </section>
}
