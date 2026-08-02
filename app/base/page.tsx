import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight, CheckCircle2, ExternalLink, ShieldCheck, Sparkles } from "lucide-react"

export const metadata: Metadata = {
  title: "Build and deploy dApps on Base | Dappster",
  description: "Generate, audit, deploy and publish Base dApps from one prompt with Dappster.",
  alternates: { canonical: "/base" },
  openGraph: {
    title: "Dappster for Base",
    description: "Generate, audit, deploy and publish Base dApps from one prompt.",
    url: "https://dappster.fun/base",
  },
}

const membershipContract = "0xea7e37d45b6f75ae6826c1925d7b0ac314c7ecae"

export default function BasePage() {
  return <section className="section technical-overview"><div className="container technical-container">
    <Link href="/" className="back-link">Dappster <ArrowRight size={14} /></Link>

    <header className="technical-hero">
      <div className="section-label">// Built on Base</div>
      <div style={{ marginTop: 22, width: 64, height: 64, padding: 10, borderRadius: 16, background: "#fff", display: "grid", placeItems: "center" }}>
        <Image src="/chain-logos/base.svg" alt="Base" width={44} height={44} priority />
      </div>
      <h1>Build on Base from one prompt.</h1>
      <p>Dappster is an AI-native developer platform for generating, auditing, deploying and publishing onchain applications. Launch a Base smart contract with your own wallet, then publish its frontend to IPFS.</p>
      <div className="technical-actions">
        <Link href="/build" className="btn btn-primary"><Sparkles size={16} /> Build a Base dApp</Link>
        <a href={`https://basescan.org/address/${membershipContract}`} target="_blank" rel="noreferrer" className="btn btn-outline">View Base contract <ExternalLink size={15} /></a>
      </div>
      <div className="technical-meta"><span>Base ecosystem</span><span>Infrastructure · Developer tool</span><span>Live at dappster.fun</span></div>
    </header>

    <article className="technical-document">
      <section>
        <div className="technical-kicker">01 / Base-native settlement</div>
        <h2>Credits and membership settle on Base</h2>
        <p>Dappster Credits and Pro membership are purchased in native Circle USDC through the public membership contract on Base. Wallet approval and payment are separate, explicit onchain actions.</p>
        <div className="technical-callout"><ShieldCheck size={22} /><div><strong>Verify before signing</strong><span>The official membership and credits contract is <code>{membershipContract}</code>. Dappster never asks for a seed phrase or private key.</span></div></div>
      </section>

      <section>
        <div className="technical-kicker">02 / Builder workflow</div>
        <h2>From idea to a working Base application</h2>
        <ul className="technical-checks">
          <li><CheckCircle2 size={16} /> Generate a Solidity contract, ABI and React frontend for Base.</li>
          <li><CheckCircle2 size={16} /> Compile and review the generated source before signing.</li>
          <li><CheckCircle2 size={16} /> Deploy the contract from your connected EVM wallet.</li>
          <li><CheckCircle2 size={16} /> Publish the frontend to IPFS and optionally list it in the Dappster Marketplace.</li>
        </ul>
      </section>

      <section>
        <div className="technical-kicker">03 / Listing information</div>
        <h2>Dappster</h2>
        <p>Dappster turns natural-language ideas into deployable Base smart contracts and frontends, with compilation, security review, wallet deployment and IPFS publishing in one workflow.</p>
        <dl className="technical-references">
          <div><dt>Primary URL</dt><dd><a href="https://dappster.fun/base">https://dappster.fun/base</a></dd></div>
          <div><dt>Category</dt><dd>Infrastructure</dd></div>
          <div><dt>Subcategory</dt><dd>Developer tool</dd></div>
          <div><dt>Creator</dt><dd><a href="https://www.base.org/name/pappardelle" target="_blank" rel="noreferrer">pappardelle.base.eth</a></dd></div>
          <div><dt>Contact</dt><dd><a href="mailto:dev@dappster.fun">dev@dappster.fun</a></dd></div>
        </dl>
        <div className="technical-actions">
          <Link href="/terms" className="btn btn-outline">Terms of Service</Link>
          <Link href="/privacy" className="btn btn-outline">Privacy Policy</Link>
          <Link href="/trust" className="btn btn-outline">Trust &amp; security</Link>
        </div>
      </section>
    </article>
  </div></section>
}
