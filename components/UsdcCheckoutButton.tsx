"use client"

import { useState } from "react"
import { Check, Loader2 } from "lucide-react"
import { createPublicClient, http, parseUnits } from "viem"
import { base } from "viem/chains"
import { apiFetch, getAccessToken, getLocalWalletSession } from "@/lib/client-api"
import { getConnectedEvmWallet } from "@/lib/connected-evm-wallet"
import {
  BASE_MEMBERSHIP_CONTRACT,
  MEMBERSHIP_ABI,
  packageContractId,
  packages,
  type PackageId,
  USDC_ABI,
  USDC_BASE_ADDRESS,
  USDC_DECIMALS,
} from "@/lib/payments"

type Stage = "connecting" | "switching" | "approving" | "signing" | "confirming" | "verifying" | "done" | null
type Workspace = { wallets?: Array<{ wallet_address: string; chain: "evm" | "solana" }> }

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function paymentError(cause: unknown) {
  if (cause && typeof cause === "object") {
    const error = cause as { shortMessage?: string; message?: string }
    if (error.shortMessage) return error.shortMessage
    if (error.message) return error.message
  }
  return "Payment failed. No subscription was activated."
}

export function UsdcCheckoutButton({ packageId, className = "btn btn-primary", label }: { packageId: PackageId; className?: string; label?: string }) {
  const [stage, setStage] = useState<Stage>(null)
  const [showSummary, setShowSummary] = useState(false)
  const [error, setError] = useState("")
  const selected = packages[packageId]

  async function requireDappsterLogin() {
    const usesSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY))
    const authenticated = usesSupabase ? Boolean(await getAccessToken()) : Boolean(getLocalWalletSession())
    if (authenticated) return true
    window.location.assign("/login?redirect=pricing")
    return false
  }

  async function activate(body: Record<string, string>) {
    setStage("verifying")
    await apiFetch("/api/payments/confirm", { method: "POST", body: JSON.stringify({ packageId, ...body }) })
    setStage("done")
    window.setTimeout(() => window.location.assign("/dashboard?payment=confirmed"), 700)
  }

  async function payBase() {
    if (!await requireDappsterLogin()) return
    try {
      if (!BASE_MEMBERSHIP_CONTRACT) throw new Error("The Base membership contract is not configured")
      setStage("connecting")
      const workspace = await apiFetch<Workspace>("/api/account/wallets", { cache: "no-store" })
      const linkedEvmAddresses = (workspace.wallets || []).filter(linked => linked.chain === "evm").map(linked => linked.wallet_address)
      if (!linkedEvmAddresses.length) {
        throw new Error("Link an EVM wallet to your Dappster account before paying. No payment was sent.")
      }
      const { address: payer, wallet } = await getConnectedEvmWallet(base, linkedEvmAddresses)
      const walletCheck = await apiFetch<{ linked: boolean }>("/api/account/wallets", {
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({ chain: "evm", address: payer }),
      })
      if (!walletCheck.linked) {
        throw new Error(`Your Dappster account is signed in, but ${shortAddress(payer)} is the active EVM wallet. Switch to your linked wallet ${shortAddress(linkedEvmAddresses[0])} and try again. No payment was sent.`)
      }
      setStage("switching")
      const amount = parseUnits(String(selected.amount), USDC_DECIMALS)
      const publicClient = createPublicClient({ chain: base, transport: http() })
      const contractPackageId = packageContractId(packageId)
      if (contractPackageId === null) {
        const configuredPrice = await publicClient.readContract({ address: BASE_MEMBERSHIP_CONTRACT, abi: MEMBERSHIP_ABI, functionName: "membershipPrice" })
        if (configuredPrice !== amount) throw new Error("This plan is temporarily unavailable because its on-chain price is being updated. No payment was sent.")
      } else {
        const [configuredPrice, configuredCredits, enabled] = await publicClient.readContract({
          address: BASE_MEMBERSHIP_CONTRACT,
          abi: MEMBERSHIP_ABI,
          functionName: "creditPackages",
          args: [contractPackageId],
        })
        if (!enabled || configuredPrice !== amount || configuredCredits !== BigInt(selected.credits)) {
          throw new Error("This credit package is temporarily unavailable because its on-chain configuration is being updated. No payment was sent.")
        }
      }
      setStage("approving")
      const approvalHash = await wallet.writeContract({
        account: payer,
        address: USDC_BASE_ADDRESS,
        abi: USDC_ABI,
        functionName: "approve",
        args: [BASE_MEMBERSHIP_CONTRACT, amount],
      })
      await publicClient.waitForTransactionReceipt({ hash: approvalHash, confirmations: 1 })

      setStage("signing")
      const txHash = contractPackageId === null
        ? await wallet.writeContract({ account: payer, address: BASE_MEMBERSHIP_CONTRACT, abi: MEMBERSHIP_ABI, functionName: "buyMembership" })
        : await wallet.writeContract({ account: payer, address: BASE_MEMBERSHIP_CONTRACT, abi: MEMBERSHIP_ABI, functionName: "buyCredits", args: [contractPackageId] })
      setStage("confirming")
      await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 })
      await activate({ network: "base", txHash, payer })
    } catch (cause) {
      setError(paymentError(cause))
      setStage(null)
    }
  }

  function continueToWallet() {
    setShowSummary(false)
    setError("")
    void payBase()
  }

  const buttonText = !stage ? `${label || `Pay ${selected.amount} USDC`} · Base`
    : stage === "connecting" ? "Connecting wallet..."
      : stage === "switching" ? "Switching to Base..."
        : stage === "approving" ? "Approving USDC..."
          : stage === "signing" ? "Confirm in wallet..."
            : stage === "confirming" ? "Confirming on Base..."
              : stage === "verifying" ? "Activating..."
                : "Activated"
  const isMembership = selected.plan === "pro"

  return <div className="usdc-checkout">
    <div className="payment-network-actions">
      <button className={className} disabled={Boolean(stage)} onClick={() => { setError(""); setShowSummary(true) }}>
        {stage === "done" ? <Check size={14} /> : stage ? <Loader2 className="animate-spin" size={14} /> : null}
        {buttonText}
      </button>
    </div>
    {error && <small className="payment-error">{error}</small>}
    {showSummary && <div className="modal-backdrop" onMouseDown={() => setShowSummary(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="payment-summary-title" onMouseDown={event => event.stopPropagation()}>
        <div className="panel-head">
          <div><div className="panel-title" id="payment-summary-title">Confirm {isMembership ? "membership" : "credit purchase"}</div><div style={{color:"#737b85",fontSize:12,marginTop:5}}>Review exactly what your wallet will authorize.</div></div>
          <button className="btn btn-ghost" type="button" aria-label="Close payment summary" onClick={() => setShowSummary(false)}>×</button>
        </div>
        <div className="panel-body form-stack">
          <div className="deploy-result">
            <div><span className="form-label">You pay</span><strong>{selected.amount} USDC</strong></div>
            <div><span className="form-label">You receive</span><strong>{isMembership ? "Pro · 30 days" : `${selected.credits} Dappster Credits`}</strong></div>
            <div><span className="form-label">Network</span><strong>Base</strong></div>
          </div>
          <p className="detail-note">Base network fees are separate. Credits and membership are shared by your linked EVM and Solana wallets.</p>
          <div style={{display:"flex",gap:10}}><button className="btn btn-outline" type="button" onClick={() => setShowSummary(false)}>Cancel</button><button className="btn btn-primary" type="button" onClick={continueToWallet}>Continue to wallet</button></div>
        </div>
      </div>
    </div>}
  </div>
}
