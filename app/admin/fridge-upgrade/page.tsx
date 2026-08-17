"use client"

import { useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js"
import { Buffer } from "buffer"
import { apiFetch } from "@/lib/client-api"

type UpgradeQuote = {
  cluster: "mainnet"
  programId: string
  programData: string
  upgradeAuthority: string
  technicalWallet: string
  buffer: string
  artifactBytes: number
  maxProgramBytes: number
  extensionBytes: number
  extensionRentLamports: number
  bufferRentLamports: number
  technicalBalanceLamports: number
  fundingRequiredLamports: number
  bufferReady: boolean
  artifactHash: string
  transaction?: string | null
  lastValidBlockHeight?: number
}

const OWNER = new PublicKey("GxPoKNX26GCisuH8Sdr8rtfZY98L5t5eegKtDzSA9P6W")
const MAINNET_CONNECTION = new Connection("https://api.mainnet-beta.solana.com", "confirmed")

function sol(lamports: number) {
  return (lamports / 1_000_000_000).toFixed(9)
}

export default function FridgeUpgradePage() {
  const wallet = useWallet()
  const [quote, setQuote] = useState<UpgradeQuote | null>(null)
  const [status, setStatus] = useState("Ready to compile and inspect the Token-2022 upgrade.")
  const [busy, setBusy] = useState(false)
  const [signature, setSignature] = useState("")

  async function ownerWallet() {
    const phantom = wallet.wallets.find(candidate => candidate.adapter.name === "Phantom")
    if (!phantom) throw new Error("Phantom is not available in this browser")
    if (!phantom.adapter.connected) await phantom.adapter.connect()
    if (!phantom.adapter.publicKey?.equals(OWNER)) {
      throw new Error(`Connect the Fridge upgrade-authority wallet ${OWNER.toBase58()}`)
    }
    return phantom.adapter
  }

  async function request(action: "quote" | "prepare") {
    return apiFetch<UpgradeQuote>("/api/admin/fridge-upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, wallet: OWNER.toBase58() }),
    })
  }

  async function inspect() {
    setBusy(true)
    try {
      setStatus("Compiling the Token-2022 program and checking Mainnet ProgramData capacity…")
      const next = await request("quote")
      setQuote(next)
      setStatus(next.fundingRequiredLamports > 0
        ? `The technical buffer needs ${sol(next.fundingRequiredLamports)} SOL before it can be uploaded.`
        : "Checks passed. The upgrade buffer can be prepared.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upgrade inspection failed")
    } finally {
      setBusy(false)
    }
  }

  async function fundBuffer() {
    if (!quote || quote.fundingRequiredLamports <= 0) return
    setBusy(true)
    try {
      const phantom = await ownerWallet()
      setStatus(`Confirm ${sol(quote.fundingRequiredLamports)} SOL funding on Solana Mainnet in Phantom…`)
      const transaction = new Transaction().add(SystemProgram.transfer({
        fromPubkey: OWNER,
        toPubkey: new PublicKey(quote.technicalWallet),
        lamports: quote.fundingRequiredLamports,
      }))
      const fundingSignature = await phantom.sendTransaction(transaction, MAINNET_CONNECTION)
      const confirmation = await MAINNET_CONNECTION.confirmTransaction(fundingSignature, "confirmed")
      if (confirmation.value.err) throw new Error("The Mainnet buffer funding transaction failed")
      setStatus("Funding confirmed. Preparing the resumable upgrade buffer…")
      const next = await request("prepare")
      setQuote(next)
      setStatus(next.transaction
        ? "Buffer ready. Review the addresses below, then sign the program upgrade."
        : "Funding is not confirmed by the deployment RPC yet. Retry Prepare buffer shortly.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Buffer funding failed")
    } finally {
      setBusy(false)
    }
  }

  async function prepare() {
    setBusy(true)
    try {
      await ownerWallet()
      setStatus("Uploading the compiled program to the resumable Mainnet buffer…")
      const next = await request("prepare")
      setQuote(next)
      setStatus(next.transaction
        ? "Buffer ready. Review the addresses below, then sign the program upgrade."
        : `The technical buffer needs ${sol(next.fundingRequiredLamports)} SOL.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Buffer preparation failed")
    } finally {
      setBusy(false)
    }
  }

  async function upgrade() {
    if (!quote?.transaction) return
    setBusy(true)
    try {
      const phantom = await ownerWallet()
      const transaction = Transaction.from(Buffer.from(quote.transaction, "base64"))
      setStatus("Confirm the Fridge Token-2022 upgrade on Solana Mainnet in Phantom…")
      const upgradeSignature = await phantom.sendTransaction(transaction, MAINNET_CONNECTION, { skipPreflight: false })
      setSignature(upgradeSignature)
      const confirmation = await MAINNET_CONNECTION.confirmTransaction(upgradeSignature, "confirmed")
      if (confirmation.value.err) throw new Error("The Fridge upgrade transaction failed on-chain")
      setStatus("Upgrade confirmed. Fridge now accepts classic SPL and Token-2022 mints, including PASTA.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Program upgrade failed")
    } finally {
      setBusy(false)
    }
  }

  return <section className="section"><div className="container" style={{ maxWidth: 860 }}>
    <div className="section-heading">
      <span className="eyebrow">Owner-only Solana upgrade</span>
      <h1>Upgrade Fridge for PASTA.</h1>
      <p>The existing Program ID, lock PDA seeds and account layout remain unchanged. Only Token-2022 support is added.</p>
    </div>
    <div className="panel form-stack">
      <div className="mono" style={{ fontSize: 12, lineHeight: 1.8 }}>
        Cluster: Solana Mainnet<br />
        Program: BQJxEcwnCLqeg4VDGHUeiCJAaAPHVuSMgP4F32bnQUXN<br />
        Upgrade authority: {OWNER.toBase58()}<br />
        Target mint: 39kMeX4HVRW9qbbiHSPbRQ9xeXUF18GrNP6gL61Ppump (Token-2022)
      </div>
      {!quote && <button className="btn btn-primary btn-block" disabled={busy} onClick={inspect}>
        {busy ? "Compiling and checking…" : "Compile & inspect upgrade"}
      </button>}
      {quote && <div className="panel" style={{ padding: 16 }}>
        <div className="mono" style={{ fontSize: 12, lineHeight: 1.8, overflowWrap: "anywhere" }}>
          ProgramData: {quote.programData}<br />
          Buffer: {quote.buffer}<br />
          Artifact: {quote.artifactBytes.toLocaleString()} / {quote.maxProgramBytes.toLocaleString()} bytes<br />
          ProgramData extension: {quote.extensionBytes.toLocaleString()} bytes ({sol(quote.extensionRentLamports)} SOL)<br />
          SHA-256: {quote.artifactHash}<br />
          Buffer rent: {sol(quote.bufferRentLamports)} SOL<br />
          Additional funding: {sol(quote.fundingRequiredLamports)} SOL
        </div>
      </div>}
      {quote?.fundingRequiredLamports ? <button className="btn btn-primary btn-block" disabled={busy} onClick={fundBuffer}>
        {busy ? "Working…" : `Fund ${sol(quote.fundingRequiredLamports)} SOL & prepare buffer`}
      </button> : null}
      {quote && quote.fundingRequiredLamports === 0 && !quote.transaction && <button className="btn btn-primary btn-block" disabled={busy} onClick={prepare}>
        {busy ? "Uploading program…" : "Prepare upgrade buffer"}
      </button>}
      {quote?.transaction && <button className="btn btn-primary btn-block" disabled={busy} onClick={upgrade}>
        {busy ? "Waiting for confirmation…" : "Sign & upgrade Fridge on Mainnet"}
      </button>}
      <p className="muted">{status}</p>
      {signature && <a className="mono" href={`https://explorer.solana.com/tx/${signature}`} target="_blank" rel="noreferrer">View confirmed upgrade transaction</a>}
    </div>
  </div></section>
}
