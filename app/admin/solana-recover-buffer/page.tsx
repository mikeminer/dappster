"use client"

import { useState } from "react"
import { apiFetch } from "@/lib/client-api"

type RecoveryResult = {
  signature?: string
  alreadyClosed?: boolean
  closed?: boolean
  recoveredSOL?: number
  destination: string
}

export default function SolanaRecoverBufferPage() {
  const [confirmation, setConfirmation] = useState("")
  const [status, setStatus] = useState("Ready")
  const [result, setResult] = useState<RecoveryResult | null>(null)
  const [busy, setBusy] = useState(false)

  async function recover() {
    try {
      setBusy(true)
      setStatus("Verifying the buffer and simulating its closure…")
      const payload = await apiFetch<RecoveryResult>("/api/admin/solana-recover-buffer", {
        method: "POST",
      })
      setResult(payload)
      setStatus(payload.alreadyClosed ? "This buffer was already closed." : "Buffer closed and rent recovered.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Recovery failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="section">
      <div className="container" style={{ maxWidth: 760 }}>
        <div className="section-heading">
          <span className="eyebrow">Owner recovery</span>
          <h1>Recover abandoned Solana buffer</h1>
          <p>This irreversible action closes only the verified incomplete deployment buffer shown below.</p>
        </div>
        <div className="panel form-stack">
          <div className="mono" style={{ fontSize: 12, lineHeight: 1.8, overflowWrap: "anywhere" }}>
            Buffer: 7NdJokUv8cNckn1Kokza3ZrXjXpZsuprX9DPjCgNZ3f6<br />
            Authority: DDrEPN9RtKiLN39VT7wkeu4ZG6Ycgh8mrxhsYDyEPLFo<br />
            Recipient: GxPoKNX26GCisuH8Sdr8rtfZY98L5t5eegKtDzSA9P6W<br />
            Expected recovery: 1.968656880 SOL
          </div>
          <label className="form-stack">
            <span>Type RECOVER to confirm</span>
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </label>
          <button
            className="btn btn-primary btn-block"
            disabled={busy || confirmation !== "RECOVER"}
            onClick={recover}
          >
            {busy ? "Recovering…" : "Close buffer and recover SOL"}
          </button>
          <p className="muted">{status}</p>
          {result?.signature && (
            <a
              className="mono"
              href={`https://explorer.solana.com/tx/${result.signature}`}
              target="_blank"
              rel="noreferrer"
            >
              View recovery transaction
            </a>
          )}
        </div>
      </div>
    </section>
  )
}
