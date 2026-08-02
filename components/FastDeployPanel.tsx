"use client"

import { useState } from "react"
import { Loader2, Rocket } from "lucide-react"
import { apiFetch } from "@/lib/client-api"
import { MarketplacePurchaseButton } from "@/components/MarketplacePurchaseButton"
import type { AssetVisibility } from "@/lib/marketplace"
import type { Chain } from "@/types"
import { getChainAdapter } from "@/lib/chain-adapters"

type DeployAccess = { visibility: AssetVisibility; price: number; unlocked: boolean; purchased: boolean }

export function FastDeployPanel({ dappId, chain, access }: { dappId: string; chain: Chain; access: DeployAccess }) {
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState("")

  const adapter = getChainAdapter(chain)
  if (access.visibility === "private" || !adapter.deploymentReady) return null

  async function prepare() {
    try {
      setPreparing(true)
      setError("")
      const result = await apiFetch<{ redirect: string }>("/api/marketplace/fast-deploy/prepare", {
        method: "POST",
        body: JSON.stringify({ dappId }),
      })
      window.location.assign(result.redirect)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Fast Deploy could not be prepared")
      setPreparing(false)
    }
  }

  return <section className="panel fast-deploy-panel">
    <div className="panel-head"><span className="panel-title">Fast Deploy</span><span className="chain-badge">{adapter.name}</span></div>
    <div className="panel-body form-stack">
      <div className="fast-deploy-intro"><Rocket size={21} /><div><strong>Deploy your own copy</strong><p>Dappster creates a private project copy and opens it in Builder, ready for deployment with your wallet.</p></div></div>
      <div className="fast-deploy-costs"><span>Creator-set access fee</span><strong>{access.visibility === "free" ? "Free" : `${access.price} USDC`}</strong><span>Network gas, protocol deployment fees and IPFS credit burns are separate.</span></div>
      {access.unlocked
        ? <button className="btn btn-primary btn-block" type="button" disabled={preparing} onClick={prepare}>{preparing ? <Loader2 className="animate-spin" size={15} /> : <Rocket size={15} />}{preparing ? "Preparing your private copy..." : "Fast deploy this dApp"}</button>
        : <MarketplacePurchaseButton dappId={dappId} asset="deploy" price={access.price} label="Buy Fast Deploy access" />}
      {error && <small className="payment-error">{error}</small>}
    </div>
  </section>
}
