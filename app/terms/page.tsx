import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export const metadata: Metadata = {
  title: "Terms of Service | Dappster",
  description: "Terms governing access to and use of Dappster.",
  alternates: { canonical: "/terms" },
}

export default function TermsPage() {
  return <section className="section technical-overview"><div className="container technical-container">
    <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to Dappster</Link>
    <header className="technical-hero">
      <div className="section-label">// Legal</div>
      <h1>Terms of Service</h1>
      <p>These terms govern your use of Dappster, including its AI generation, compilation, audit, deployment, payment, IPFS publishing and Marketplace features.</p>
      <div className="technical-meta"><span>Effective August 2, 2026</span><span>Contact: dev@dappster.fun</span></div>
    </header>
    <article className="technical-document">
      <section><div className="technical-kicker">01 / Acceptance</div><h2>Using Dappster</h2><p>By accessing or using Dappster, you agree to these terms. You must be legally able to enter into this agreement and, when acting for an organization, authorized to bind it. Do not use the service if you do not agree.</p></section>
      <section><div className="technical-kicker">02 / Service</div><h2>Generated software requires your review</h2><p>Dappster helps users generate and operate software, but generated code, simulations and automated audits may contain errors or vulnerabilities. You are responsible for reviewing, testing and independently auditing code before production use, especially where material value is at risk.</p><p>The service may change, be interrupted or discontinue individual networks, models or integrations. No feature is guaranteed to remain available.</p></section>
      <section><div className="technical-kicker">03 / Wallets and blockchains</div><h2>You control every transaction</h2><p>You are responsible for your wallets, keys, balances, network selection and transactions. Blockchain transactions and IPFS publications may be public, permanent and irreversible. Dappster cannot reverse a confirmed transaction, recover private keys or guarantee the operation of a third-party wallet, RPC, blockchain or gateway.</p></section>
      <section><div className="technical-kicker">04 / Payments and credits</div><h2>USDC payments on Base</h2><p>Credit packages and memberships are purchased in USDC on Base through the contract and prices displayed before signing. Network gas and deployment fees are separate. Credits are service-access assets, are not legal tender, and are not represented as investments. Purchases are final once confirmed onchain except where mandatory law requires otherwise.</p></section>
      <section><div className="technical-kicker">05 / Your content</div><h2>Prompts, code and publications</h2><p>You retain your rights in content you submit and in generated output to the extent permitted by law and applicable model terms. You grant Dappster the limited rights needed to process, store and transmit that content to provide the service. If you publish a project or source in the Marketplace or on IPFS, you direct Dappster to make the selected material public.</p><p>You must have the rights needed for submitted content and must not publish malware, stolen material, unlawful content or code intended to deceive, exploit or harm others.</p></section>
      <section><div className="technical-kicker">06 / Acceptable use</div><h2>Build responsibly</h2><p>Do not bypass access controls, probe other users&apos; data, abuse infrastructure, manipulate credits or payments, disrupt the service, infringe intellectual-property rights, violate sanctions or law, or use Dappster to facilitate fraud, theft or unauthorized access.</p></section>
      <section><div className="technical-kicker">07 / Disclaimers and liability</div><h2>Use at your own risk</h2><p>Dappster is provided on an “as is” and “as available” basis to the maximum extent permitted by law. No warranty is made that generated code is secure, fit for a particular purpose or free from defects. To the maximum extent permitted by law, Dappster is not liable for indirect or consequential loss, lost assets, lost profits, blockchain failures or actions you authorize through your wallet. Mandatory consumer rights remain unaffected.</p></section>
      <section><div className="technical-kicker">08 / Changes and contact</div><h2>Updates to these terms</h2><p>Material updates will be posted on this page with a new effective date. Continued use after an update constitutes acceptance where permitted by law. Questions may be sent to <a href="mailto:dev@dappster.fun">dev@dappster.fun</a>.</p></section>
    </article>
  </div></section>
}
