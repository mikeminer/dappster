"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Coins, X } from "lucide-react"

export function CreditsRequiredModal() {
  const [message, setMessage] = useState("")

  function close() {
    setMessage("")
  }

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMessage("")
    }
    function showModal(event: Event) {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      setMessage(detail?.message || "You do not have enough credits to complete this action.")
    }
    document.addEventListener("keydown", closeOnEscape)
    window.addEventListener("dappster:credits-required", showModal)
    return () => {
      document.removeEventListener("keydown", closeOnEscape)
      window.removeEventListener("dappster:credits-required", showModal)
    }
  }, [])

  if (!message) return null

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal credits-required-modal" role="dialog" aria-modal="true" aria-labelledby="credits-required-title" aria-describedby="credits-required-description" onMouseDown={event => event.stopPropagation()}>
        <button className="credits-modal-close" type="button" onClick={close} aria-label="Close"><X size={17} /></button>
        <div className="credits-modal-icon"><Coins size={24} /></div>
        <h2 id="credits-required-title">Insufficient credits</h2>
        <p className="credits-modal-message">{message}</p>
        <p id="credits-required-description">Upgrade your plan or purchase additional credits to continue.</p>
        <Link href="/#pricing" className="btn btn-primary btn-block" onClick={close}>View plans and credits</Link>
        <button className="btn btn-ghost btn-block" type="button" onClick={close}>Not now</button>
      </div>
    </div>
  )
}
