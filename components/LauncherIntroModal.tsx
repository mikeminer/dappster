"use client"

import Image from "next/image"
import { ExternalLink, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

const SESSION_KEY = "dappster:launcher-intro:v3"
const CREATOR_URL = "https://www.base.org/name/pappardelle"
const CREATOR_TOKEN_URL = "https://pappardellefaucet.vercel.app/"
const PASTA_TOKEN_URL = "https://pump.fun/coin/39kMeX4HVRW9qbbiHSPbRQ9xeXUF18GrNP6gL61Ppump"
const SUBSCRIPTION_CONTRACT = "0xea7e37d45b6f75ae6826c1925d7b0ac314c7ecae"
const CONTRACT_URL = `https://basescan.org/address/${SUBSCRIPTION_CONTRACT}`

const DEPLOYMENT_BENEFITS = [
  {
    ecosystem: "EVM",
    amount: "50,000,000 pappardelle",
    description: "Link the qualifying EVM wallet for unlimited EVM generations and security audits while preparing deployments across supported networks.",
    disclaimer: "The 0.001 native-token deployment fee and network gas still apply.",
    href: CREATOR_TOKEN_URL,
    logo: "/chain-logos/ethereum.svg",
  },
  {
    ecosystem: "Solana",
    amount: "10,000,000 PASTA",
    description: "Link the qualifying Solana mainnet wallet for unlimited generations and security audits on Solana mainnet and devnet.",
    disclaimer: "Program rent, network fees and IPFS publishing costs still apply.",
    href: PASTA_TOKEN_URL,
    logo: "/chain-logos/solana.svg",
  },
] as const

export function LauncherIntroModal() {
  const [open, setOpen] = useState(false)

  const close = useCallback(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, "dismissed")
    } catch {
      // Storage can be unavailable in private contexts.
    }
    setOpen(false)
  }, [])

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY) !== "dismissed") setOpen(true)
    } catch {
      setOpen(true)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [close, open])

  if (!open) return null

  return (
    <div className="modal-backdrop launcher-intro-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      <section className="modal launcher-intro-modal" role="dialog" aria-modal="true" aria-labelledby="launcher-intro-title" aria-describedby="launcher-intro-description">
        <meta name="base:app_id" content="6a6f47882c28265d676170a5" />
        <button type="button" className="credits-modal-close" aria-label="Close introduction" onClick={close}><X size={18} /></button>
        <div className="launcher-intro-mark" aria-hidden="true"><span>D</span></div>
        <p className="launcher-intro-kicker">DAPPSTER.FUN</p>
        <h2 id="launcher-intro-title">Multichain dApp launcher</h2>
        <p id="launcher-intro-description" className="launcher-intro-copy">
          Build, deploy and publish onchain products across multiple ecosystems from one launchpad.
        </p>
        <a className="launcher-intro-creator" href={CREATOR_URL} target="_blank" rel="noopener noreferrer">
          Built by <strong>pappardelle.base.eth</strong><ExternalLink size={13} aria-hidden="true" />
        </a>
        <a className="launcher-intro-token" href={CREATOR_TOKEN_URL} target="_blank" rel="noopener noreferrer">
          Discover the Pappardelle creator token on Base
          <ExternalLink size={14} aria-hidden="true" />
        </a>
        <div className="launcher-intro-benefits" aria-label="Token holder deployment benefits">
          <p className="launcher-intro-benefits-title">Hold tokens. Build for deployment without generation or audit fees.</p>
          <div className="launcher-intro-benefits-grid">
            {DEPLOYMENT_BENEFITS.map(benefit => (
              <a className="launcher-intro-benefit" href={benefit.href} target="_blank" rel="noopener noreferrer" key={benefit.ecosystem}>
                <span className="launcher-intro-benefit-logo"><Image src={benefit.logo} alt="" width={30} height={30} /></span>
                <span className="launcher-intro-benefit-copy">
                  <small>{benefit.ecosystem} HOLDER BENEFIT</small>
                  <strong>Hold {benefit.amount}</strong>
                  <span>{benefit.description}</span>
                  <em>{benefit.disclaimer}</em>
                </span>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ))}
          </div>
        </div>
        <a className="launcher-intro-contract" href={CONTRACT_URL} target="_blank" rel="noopener noreferrer">
          <span className="launcher-intro-base-logo"><Image src="/chain-logos/base.svg" alt="Base" width={42} height={42} /></span>
          <span><small>SUBSCRIPTION SMART CONTRACT</small><strong>Based on Base</strong><code>{SUBSCRIPTION_CONTRACT.slice(0, 10)}…{SUBSCRIPTION_CONTRACT.slice(-8)}</code></span>
          <ExternalLink size={16} aria-hidden="true" />
        </a>
        <button type="button" className="btn btn-primary btn-block launcher-intro-enter" onClick={close} autoFocus>Enter Dappster</button>
      </section>
    </div>
  )
}
