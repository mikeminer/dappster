"use client"

import { useState } from "react"
import { Check, ExternalLink, Loader2, Rocket } from "lucide-react"
import { createPublicClient, createWalletClient, custom, type Abi } from "viem"
import { base } from "viem/chains"
import { apiFetch } from "@/lib/client-api"
import { BASE_MEMBERSHIP_CONTRACT, MEMBERSHIP_ABI, USDC_BASE_ADDRESS } from "@/lib/payments"

const OWNER = "0x5d69c42a3a481d0ccfd88cfa8a2a08e2bf456134" as const

type Artifact = { abi: Abi; bytecode: `0x${string}` }

export function MembershipDeployer() {
  const [stage, setStage] = useState("")
  const [address, setAddress] = useState<`0x${string}` | "">("")
  const [txHash, setTxHash] = useState<`0x${string}` | "">("")
  const [error, setError] = useState("")

  async function deploy() {
    setError("")
    try {
      if (!("ethereum" in window)) throw new Error("An EVM wallet is not available in this browser")
      setStage("Compiling contract…")
      const artifact = await apiFetch<Artifact>("/api/admin/membership-artifact")
      const transport = custom((window as typeof window & { ethereum: unknown }).ethereum as never)
      const wallet = createWalletClient({ chain: base, transport })
      const account = (await wallet.requestAddresses())[0]
      if (!account || account.toLowerCase() !== OWNER) throw new Error(`Connect the owner wallet ${OWNER}`)
      setStage("Switching to Base…")
      await wallet.switchChain({ id: base.id })
      setStage("Confirm the deployment in your wallet…")
      const hash = await wallet.deployContract({
        account,
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args: [OWNER, USDC_BASE_ADDRESS, OWNER, OWNER, "https://dappster.fun/api/token/{id}"],
      })
      setTxHash(hash)
      setStage("Waiting for on-chain confirmation…")
      const receipt = await createPublicClient({ chain: base, transport }).waitForTransactionReceipt({ hash, confirmations: 1 })
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("The deployment did not succeed")
      setAddress(receipt.contractAddress)
      setStage("Completed")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Deployment failed")
      setStage("")
    }
  }

  async function updateFreePlan() {
    setError("")
    try {
      if (!BASE_MEMBERSHIP_CONTRACT) throw new Error("The Base membership contract is not configured")
      if (!("ethereum" in window)) throw new Error("An EVM wallet is not available in this browser")
      const transport = custom((window as typeof window & { ethereum: unknown }).ethereum as never)
      const wallet = createWalletClient({ chain: base, transport })
      const account = (await wallet.requestAddresses())[0]
      if (!account || account.toLowerCase() !== OWNER) throw new Error(`Connect the owner wallet ${OWNER}`)
      setStage("Switching to Base…")
      await wallet.switchChain({ id: base.id })
      setStage("Confirm the 5 USDC update in your wallet…")
      const hash = await wallet.writeContract({
        account,
        address: BASE_MEMBERSHIP_CONTRACT,
        abi: MEMBERSHIP_ABI,
        functionName: "setCreditPackage",
        args: [BigInt(1), BigInt(5_000_000), BigInt(50), true],
      })
      setTxHash(hash)
      setStage("Waiting for on-chain confirmation…")
      const receipt = await createPublicClient({ chain: base, transport }).waitForTransactionReceipt({ hash, confirmations: 1 })
      if (receipt.status !== "success") throw new Error("The update did not succeed")
      setStage("Just Check plan updated: 5 USDC · 50 credits")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Update failed")
      setStage("")
    }
  }

  return <section className="panel" style={{maxWidth:760,margin:"0 auto"}}><div className="panel-head"><span className="panel-title">Base membership protocol</span><span className="chain-badge">Base · 8453</span></div><div className="panel-body form-stack"><p style={{color:"#929aa4",lineHeight:1.7,fontSize:13}}>Deploy DappsterMembership with the official Base USDC. Initial owner, treasury, and consumer: <span className="mono">{OWNER}</span>.</p>{error && <div className="error-box">{error}</div>}{address ? <div className="deploy-result"><div><span className="status"><span className="status-dot"/> Contract deployed</span><div className="mono">{address}</div></div><a className="btn btn-outline" href={`https://basescan.org/address/${address}`} target="_blank" rel="noreferrer">BaseScan <ExternalLink size={14}/></a></div> : <button className="btn btn-primary btn-block" onClick={deploy} disabled={Boolean(stage)}>{stage ? <Loader2 className="animate-spin" size={16}/> : <Rocket size={16}/>} {stage || "Deploy membership contract"}</button>}{BASE_MEMBERSHIP_CONTRACT && <button className="btn btn-outline btn-block" onClick={updateFreePlan} disabled={Boolean(stage)}>Set Just Check · 5 USDC · 50 credits</button>}{txHash && <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer" className="btn btn-ghost"><Check size={14}/> Transaction {txHash.slice(0,10)}…</a>}</div></section>
}
