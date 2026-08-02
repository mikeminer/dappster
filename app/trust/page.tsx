import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, CheckCircle2, ExternalLink, Mail, ShieldCheck } from "lucide-react"

export const metadata: Metadata = {
  title: "Trust and security | Dappster",
  description: "Official domains, contracts, wallet flows, security controls, and vulnerability reporting for Dappster.",
  alternates: { canonical: "/trust" },
}

const transactionFacts = [
  "Connecting a wallet or signing in does not transfer assets. Dappster never asks for a seed phrase or private key.",
  "Credit purchases and memberships settle in native Circle USDC on Base and require an explicit transaction approval in the user's wallet.",
  "EVM deployments are contract-creation transactions signed by the user's wallet. The generated constructor atomically forwards the disclosed 0.001 native-token deployment fee.",
  "Credit consumption is authorized by the linked user wallet and protected by unique usage identifiers against replay.",
  "Solana deployment funding is tied to one job by cluster, sender, recipient, amount, signature, and unique memo before the technical wallet can act.",
]

export default function TrustPage() {
  return <section className="section technical-overview"><div className="container technical-container">
    <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to Dappster</Link>

    <header className="technical-hero">
      <div className="section-label">// Trust and security</div>
      <h1>Verify Dappster before you sign.</h1>
      <p>This is Dappster&apos;s canonical trust center for users, wallet providers, security vendors, and integration partners. Verify the official domain, public addresses, and transaction behavior below.</p>
      <div className="technical-actions">
        <a className="btn btn-primary" href="mailto:dev@dappster.fun"><Mail size={15} /> dev@dappster.fun</a>
        <Link className="btn btn-outline" href="/technical-overview">Read the technical overview</Link>
      </div>
      <div className="technical-meta"><span>Canonical domain: dappster.fun</span><span>Last reviewed August 1, 2026</span><span>English reports preferred</span></div>
    </header>

    <article className="technical-document">
      <section id="identity">
        <div className="technical-kicker">01 / Official identity</div>
        <h2>Canonical public endpoints</h2>
        <dl className="technical-references">
          <div><dt>Production application</dt><dd><a href="https://dappster.fun">https://dappster.fun</a></dd></div>
          <div><dt>Marketplace</dt><dd><a href="https://dappster.fun/explore">https://dappster.fun/explore</a></dd></div>
          <div><dt>Security contact</dt><dd><a href="mailto:dev@dappster.fun">dev@dappster.fun</a></dd></div>
          <div><dt>Security.txt</dt><dd><a href="https://dappster.fun/.well-known/security.txt">/.well-known/security.txt</a></dd></div>
          <div><dt>Technical document</dt><dd><a href="/docs/Dappster-Technical-Overview.pdf">Download the public PDF</a></dd></div>
        </dl>
      </section>

      <section id="addresses">
        <div className="technical-kicker">02 / Official onchain addresses</div>
        <h2>Public contracts and operational wallets</h2>
        <div className="table-wrap"><table className="table technical-table"><thead><tr><th>Role</th><th>Network</th><th>Address</th></tr></thead><tbody>
          <tr><td><strong>Membership and credits</strong></td><td>Base</td><td><a href="https://basescan.org/address/0xea7e37d45b6f75ae6826c1925d7b0ac314c7ecae" target="_blank" rel="noreferrer"><code>0xea7e37d45b6f75ae6826c1925d7b0ac314c7ecae</code> <ExternalLink size={12} /></a></td></tr>
          <tr><td><strong>Owner and deployment fee recipient</strong></td><td>EVM</td><td><a href="https://basescan.org/address/0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134" target="_blank" rel="noreferrer"><code>0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134</code> <ExternalLink size={12} /></a></td></tr>
          <tr><td><strong>Owner</strong></td><td>Solana</td><td><a href="https://explorer.solana.com/address/GxPoKNX26GCisuH8Sdr8rtfZY98L5t5eegKtDzSA9P6W" target="_blank" rel="noreferrer"><code>GxPoKNX26GCisuH8Sdr8rtfZY98L5t5eegKtDzSA9P6W</code> <ExternalLink size={12} /></a></td></tr>
          <tr><td><strong>Technical deployer</strong></td><td>Solana Mainnet</td><td><a href="https://explorer.solana.com/address/DDrEPN9RtKiLN39VT7wkeu4ZG6Ycgh8mrxhsYDyEPLFo" target="_blank" rel="noreferrer"><code>DDrEPN9RtKiLN39VT7wkeu4ZG6Ycgh8mrxhsYDyEPLFo</code> <ExternalLink size={12} /></a></td></tr>
          <tr><td><strong>Technical deployer</strong></td><td>Solana Devnet</td><td><a href="https://explorer.solana.com/address/DDrEPN9RtKiLN39VT7wkeu4ZG6Ycgh8mrxhsYDyEPLFo?cluster=devnet" target="_blank" rel="noreferrer"><code>DDrEPN9RtKiLN39VT7wkeu4ZG6Ycgh8mrxhsYDyEPLFo</code> <ExternalLink size={12} /></a></td></tr>
        </tbody></table></div>
        <p>The same disclosed technical-deployer address is used on both Solana clusters. Mainnet and Devnet balances, transactions, and program accounts remain separate.</p>
        <p>Never trust an address shown only in a social post or direct message. Compare it with this page and inspect the complete transaction in your wallet before signing.</p>
      </section>

      <section id="transactions">
        <div className="technical-kicker">03 / Transaction guarantees</div>
        <h2>What a legitimate Dappster prompt can do</h2>
        <ul className="technical-checks">{transactionFacts.map((fact) => <li key={fact}><CheckCircle2 size={16} /> {fact}</li>)}</ul>
        <div className="technical-code-fact"><span>EVM deployment fee</span><strong>0.001 native token</strong><span>Credit settlement</span><strong>USDC on Base</strong></div>
      </section>

      <section id="controls">
        <div className="technical-kicker">04 / Security controls</div>
        <h2>Defense in depth</h2>
        <div className="technical-grid">
          <div><strong>Non-custodial EVM flow</strong><p>The connected wallet signs and broadcasts EVM transactions. Dappster does not receive wallet secrets.</p></div>
          <div><strong>Onchain verification</strong><p>Backend checks validate chain, receipt status, destination, amount, emitted events, and deployed address before synchronizing state.</p></div>
          <div><strong>Account isolation</strong><p>Supabase Row Level Security and linked-wallet ownership checks protect private projects, audits, payments, and deployment jobs.</p></div>
          <div><strong>Replay protection</strong><p>Unique usage IDs, payment references, deployment job IDs, and Solana funding memos prevent reuse across actions.</p></div>
          <div><strong>Restricted compilation</strong><p>Solidity imports are limited to bundled OpenZeppelin sources, while Solana builds run in an isolated environment.</p></div>
          <div><strong>Browser protections</strong><p>Production responses use HTTPS, HSTS, Content Security Policy, anti-framing controls, and same-origin restrictions.</p></div>
        </div>
        <div className="technical-callout"><ShieldCheck size={22} /><div><strong>Independent review still matters</strong><span>AI generation, compilation, simulation, and automated audits reduce risk but do not replace a professional audit for high-value applications.</span></div></div>
      </section>

      <section id="reporting">
        <div className="technical-kicker">05 / Vulnerability disclosure</div>
        <h2>Report a security issue</h2>
        <p>Email <a href="mailto:dev@dappster.fun?subject=Dappster%20security%20report">dev@dappster.fun</a> with the affected URL or component, reproduction steps, observed impact, wallet and transaction identifiers when relevant, and a safe proof of concept. Do not include seed phrases, private keys, passwords, or other secrets.</p>
        <p>Please avoid privacy violations, service disruption, social engineering, and accessing data that does not belong to you. We will use the same email thread to acknowledge, investigate, and coordinate remediation.</p>
      </section>
    </article>
  </div></section>
}
