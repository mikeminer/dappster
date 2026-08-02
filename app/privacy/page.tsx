import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export const metadata: Metadata = {
  title: "Privacy Policy | Dappster",
  description: "How Dappster collects, uses and protects personal data.",
  alternates: { canonical: "/privacy" },
}

export default function PrivacyPage() {
  return <section className="section technical-overview"><div className="container technical-container">
    <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to Dappster</Link>
    <header className="technical-hero">
      <div className="section-label">// Privacy</div>
      <h1>Privacy Policy</h1>
      <p>This policy explains the information Dappster processes when you sign in, connect wallets, generate projects, make payments, deploy or publish.</p>
      <div className="technical-meta"><span>Effective August 2, 2026</span><span>Privacy contact: dev@dappster.fun</span></div>
    </header>
    <article className="technical-document">
      <section><div className="technical-kicker">01 / Data controller</div><h2>Contact Dappster</h2><p>Dappster determines how personal data is used for this service. Privacy requests can be sent to <a href="mailto:dev@dappster.fun?subject=Dappster%20privacy%20request">dev@dappster.fun</a>.</p></section>
      <section><div className="technical-kicker">02 / Information collected</div><h2>Data needed to operate the platform</h2><p>Dappster may process account and authentication identifiers; linked public wallet addresses; prompts, generated source and project settings; transaction hashes, contract addresses and deployment records; subscription and credit activity; support messages; and technical logs such as IP address, browser information, timestamps and error details.</p><p>Wallet addresses and confirmed blockchain activity are public by design. Dappster does not request or store seed phrases or wallet private keys.</p></section>
      <section><div className="technical-kicker">03 / Purposes and legal bases</div><h2>Why information is used</h2><p>Information is used to authenticate users, link wallets, provide generation and deployment services, verify onchain actions, maintain credit balances and project history, prevent fraud and replay, secure and troubleshoot the service, respond to requests, comply with law and improve reliability. Depending on the context, processing is based on contract performance, legitimate interests, legal obligations or consent.</p></section>
      <section><div className="technical-kicker">04 / Service providers</div><h2>Infrastructure and processing partners</h2><p>Dappster uses providers including Vercel for hosting, Supabase for authentication and database services, xAI or other disclosed AI providers for generation, Pinata and public IPFS gateways for publishing, Reown/WalletConnect for wallet connectivity, and public blockchain networks and RPC providers for onchain operations. These providers process information under their own terms and privacy practices.</p></section>
      <section><div className="technical-kicker">05 / Public and permanent data</div><h2>Blockchains, Marketplace and IPFS</h2><p>Transactions, wallet addresses and deployed contracts are publicly observable. Projects, source, audits or profiles you deliberately make public may appear in the Dappster Marketplace. Content published to IPFS may remain available through independent nodes or gateways even after it is removed from Dappster&apos;s interface.</p></section>
      <section><div className="technical-kicker">06 / Retention and security</div><h2>Storage is limited to operational needs</h2><p>Account, project, payment and security records are retained while needed to provide the service, resolve disputes, prevent abuse and meet legal obligations. Retention may differ for public blockchain or IPFS records that Dappster cannot delete. Administrative, technical and access controls are used to reduce unauthorized access, but no online service can guarantee absolute security.</p></section>
      <section><div className="technical-kicker">07 / Your choices and rights</div><h2>Access, correction and deletion</h2><p>Depending on your location, you may request access, correction, deletion, restriction, portability or objection, and may withdraw consent where processing relies on consent. You may also complain to your local data-protection authority. Dappster may need to verify your identity or linked wallet before acting. Public blockchain and IPFS data cannot generally be erased by Dappster.</p></section>
      <section><div className="technical-kicker">08 / Cookies and local storage</div><h2>Essential browser state</h2><p>Dappster uses essential browser storage for sessions, wallet connectivity, security state and interface preferences. Third-party wallet or authentication services may set their own essential storage. Dappster does not use this policy to authorize unrelated advertising tracking.</p></section>
      <section><div className="technical-kicker">09 / Children and updates</div><h2>Age limits and policy changes</h2><p>Dappster is not directed to children under 13, or a higher minimum age where local law requires it. Material policy updates will be posted here with a revised effective date. Questions can be sent to <a href="mailto:dev@dappster.fun">dev@dappster.fun</a>.</p></section>
    </article>
  </div></section>
}
