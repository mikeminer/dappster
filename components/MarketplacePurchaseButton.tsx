"use client"

import { useState } from "react"
import { Check, Loader2, LockKeyhole } from "lucide-react"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token"
import { PublicKey, Transaction } from "@solana/web3.js"
import { createPublicClient, http } from "viem"
import { base } from "viem/chains"
import { apiFetch, getAccessToken } from "@/lib/client-api"
import { getConnectedEvmWallet } from "@/lib/connected-evm-wallet"
import { USDC_ABI, USDC_BASE_ADDRESS, USDC_DECIMALS, USDC_SOLANA_MINT } from "@/lib/payments"
import type { MarketplaceAsset, MarketplaceNetwork } from "@/lib/marketplace"

type Quote = {
  alreadyPurchased?: boolean
  network: MarketplaceNetwork
  amount: number
  payer: string
  creator: string
  platform: string
  creatorMicros: string
  platformMicros: string
}

export function MarketplacePurchaseButton({ dappId, asset, price, label }: { dappId: string; asset: MarketplaceAsset; price: number; label?: string }) {
  const [stage, setStage] = useState("")
  const [error, setError] = useState("")
  const solana = useWallet()
  const { connection } = useConnection()

  async function purchase() {
    try {
      setError("")
      if (!await getAccessToken()) {
        window.location.assign("/login")
        return
      }
      setStage("Preparing purchase...")
      const quote = await apiFetch<Quote>("/api/marketplace/quote", { method: "POST", body: JSON.stringify({ dappId, asset }) })
      if (quote.alreadyPurchased) {
        window.location.reload()
        return
      }
      if (quote.network === "base") await payBase(quote)
      else await paySolana(quote)
      setStage("Access unlocked")
      window.setTimeout(() => window.location.reload(), 600)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Purchase failed")
      setStage("")
    }
  }

  async function payBase(quote: Quote) {
    const { address: payer, wallet } = await getConnectedEvmWallet(base)
    if (payer.toLowerCase() !== quote.payer.toLowerCase()) throw new Error("Connect the Base wallet used to sign in")
    const client = createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL) })
    setStage(`Paying creator ${Number(quote.creatorMicros) / 1_000_000} USDC...`)
    const creatorTxHash = await wallet.writeContract({ account: payer, address: USDC_BASE_ADDRESS, abi: USDC_ABI, functionName: "transfer", args: [quote.creator as `0x${string}`, BigInt(quote.creatorMicros)] })
    await client.waitForTransactionReceipt({ hash: creatorTxHash, confirmations: 1 })
    setStage(`Paying platform ${Number(quote.platformMicros) / 1_000_000} USDC...`)
    const platformTxHash = await wallet.writeContract({ account: payer, address: USDC_BASE_ADDRESS, abi: USDC_ABI, functionName: "transfer", args: [quote.platform as `0x${string}`, BigInt(quote.platformMicros)] })
    await client.waitForTransactionReceipt({ hash: platformTxHash, confirmations: 1 })
    setStage("Verifying payment...")
    await apiFetch("/api/marketplace/confirm", { method: "POST", body: JSON.stringify({ network: "base", dappId, asset, payer, creatorTxHash, platformTxHash }) })
  }

  async function paySolana(quote: Quote) {
    const adapter = solana.wallet?.adapter
    if (!adapter) throw new Error("Select or install a Solana wallet such as Phantom")
    if (!adapter.connected) await adapter.connect()
    const payer = adapter.publicKey
    if (!payer || payer.toBase58() !== quote.payer) throw new Error("Connect the Solana wallet used to sign in")
    const mint = new PublicKey(USDC_SOLANA_MINT)
    const payerAta = getAssociatedTokenAddressSync(mint, payer)
    const creator = new PublicKey(quote.creator)
    const platform = new PublicKey(quote.platform)
    const creatorAta = getAssociatedTokenAddressSync(mint, creator)
    const platformAta = getAssociatedTokenAddressSync(mint, platform)
    const transaction = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(payer, creatorAta, creator, mint),
      createAssociatedTokenAccountIdempotentInstruction(payer, platformAta, platform, mint),
      createTransferCheckedInstruction(payerAta, mint, creatorAta, payer, BigInt(quote.creatorMicros), USDC_DECIMALS),
      createTransferCheckedInstruction(payerAta, mint, platformAta, payer, BigInt(quote.platformMicros), USDC_DECIMALS),
    )
    setStage("Confirm the atomic USDC payment in your wallet...")
    const signature = await adapter.sendTransaction(transaction, connection)
    const confirmation = await connection.confirmTransaction(signature, "confirmed")
    if (confirmation.value.err) throw new Error("The Solana payment failed")
    setStage("Verifying payment...")
    await apiFetch("/api/marketplace/confirm", { method: "POST", body: JSON.stringify({ network: "solana", dappId, asset, payer: payer.toBase58(), signature }) })
  }

  const busy = Boolean(stage)
  return <div className="marketplace-purchase"><button className="btn btn-primary btn-block" type="button" onClick={purchase} disabled={busy}>{busy ? <Loader2 className="animate-spin" size={15} /> : stage === "Access unlocked" ? <Check size={15} /> : <LockKeyhole size={15} />}{stage || label || `Unlock for ${price} USDC`}</button>{error && <small className="payment-error">{error}</small>}</div>
}
