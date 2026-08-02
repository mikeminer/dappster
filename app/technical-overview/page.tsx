import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, CheckCircle2, ExternalLink, FileDown, ShieldCheck } from "lucide-react"

export const metadata: Metadata = {
  title: "Technical overview and security model | Dappster",
  description: "Architecture, transaction flows, security controls, and trust boundaries for Dappster's EVM and Solana deployment platform.",
  alternates: { canonical: "/technical-overview" },
}

const evmNetworks = [
  ["Ethereum", "1", "Mainnet"],
  ["Base", "8453", "Mainnet"],
  ["Arbitrum One", "42161", "Mainnet"],
  ["OP Mainnet", "10", "Mainnet"],
  ["Polygon PoS", "137", "Mainnet"],
  ["Avalanche C-Chain", "43114", "Mainnet"],
  ["BNB Smart Chain", "56", "Mainnet"],
  ["Gnosis", "100", "Mainnet"],
  ["Celo", "42220", "Mainnet"],
  ["Scroll", "534352", "Mainnet"],
  ["Linea", "59144", "Mainnet"],
  ["ZKsync Era", "324", "Mainnet"],
  ["Mantle", "5000", "Mainnet"],
  ["Blast", "81457", "Mainnet"],
  ["Mode", "34443", "Mainnet"],
  ["Berachain", "80094", "Mainnet"],
  ["Sonic", "146", "Mainnet"],
  ["Fraxtal", "252", "Mainnet"],
  ["Metis", "1088", "Mainnet"],
  ["ApeChain", "33139", "Mainnet"],
  ["Monad", "143", "Mainnet"],
  ["Robinhood Chain", "4663", "Mainnet"],
  ["HyperEVM", "999", "Mainnet"],
  ["Ethereum Sepolia", "11155111", "Testnet"],
  ["Base Sepolia", "84532", "Testnet"],
]

const evmFlow = [
  "The authenticated user selects a supported EVM network and asks Dappster to generate a contract and frontend.",
  "Dappster compiles the Solidity source with solc, permits only bundled OpenZeppelin imports, and returns the ABI and creation bytecode.",
  "Before the wallet prompt, Dappster simulates the exact contract-creation payload against the selected chain RPC and estimates gas.",
  "The connected wallet signs and submits the deployment. Dappster never receives the wallet private key or seed phrase.",
  "After confirmation, the backend verifies the successful receipt, contract address, contract-creation form, exact 0.001 native-token value, fee recipient, and emitted fee event.",
  "Only after verification may the generated frontend be wrapped with deployment metadata and published to IPFS.",
]

const solanaFlow = [
  "Dappster compiles the generated Anchor program in an isolated build environment and calculates program rent plus deployment costs.",
  "The user's linked Solana wallet signs a funding transfer to the disclosed technical wallet. The transaction includes a unique deployment-job memo.",
  "The backend verifies cluster, linked sender, recipient, minimum amount, memo, signature status, and the user's separate deployment-authorization signature.",
  "A job queue and cluster lock prevent concurrent jobs from using the same deployment wallet state at the same time.",
  "The technical wallet writes and deploys the compiled program with Solana's Upgradeable Loader, verifies the executable account, then transfers upgrade authority to the user's wallet.",
  "The frontend is published only after the Program ID is verified on the selected cluster. The technical wallet is not used for EVM deployments.",
]

export default function TechnicalOverviewPage() {
  return <section className="section technical-overview"><div className="container technical-container">
    <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to Dappster</Link>

    <header className="technical-hero">
      <div className="section-label">// Security and architecture</div>
      <h1>Dappster technical overview</h1>
      <p>Public documentation for wallet providers, security vendors, users, and integration partners. This document describes the production transaction flows and trust boundaries used by <a href="https://dappster.fun">dappster.fun</a>.</p>
      <div className="technical-actions">
        <a className="btn btn-primary" href="/docs/Dappster-Technical-Overview.pdf" download><FileDown size={15} /> Download PDF</a>
        <a className="btn btn-outline" href="https://basescan.org/address/0xea7e37d45b6f75ae6826c1925d7b0ac314c7ecae" target="_blank" rel="noreferrer">Base membership contract <ExternalLink size={14} /></a>
      </div>
      <div className="technical-meta"><span>Version 1.0</span><span>Published July 31, 2026</span><span>Canonical domain: dappster.fun</span></div>
    </header>

    <article className="technical-document">
      <section id="summary">
        <div className="technical-kicker">01 / Executive summary</div>
        <h2>What Dappster does</h2>
        <p>Dappster is an AI-assisted application builder that generates smart-contract source, frontend source, deployment instructions, and optional automated audit reports. Users can review and preview generated artifacts before deployment. On EVM networks, deployments remain non-custodial: the connected wallet signs and broadcasts the contract-creation transaction. On Solana, a disclosed, user-funded technical wallet performs program deployment after a wallet-signed authorization and transfers upgrade authority to the user.</p>
        <div className="technical-callout"><ShieldCheck size={22} /><div><strong>Key custody statement</strong><span>Dappster does not request, collect, or store EVM or user Solana seed phrases and private keys. Users must approve wallet connection, payments, credit burns, and deployment-related signatures in their own wallet interface.</span></div></div>
      </section>

      <section id="architecture">
        <div className="technical-kicker">02 / Architecture</div>
        <h2>System components</h2>
        <div className="technical-grid">
          <div><strong>Web application</strong><p>Next.js and TypeScript application hosted on Vercel. Wallet connections use wagmi/viem for EVM, WalletConnect-compatible connectors, and the Solana wallet adapter.</p></div>
          <div><strong>Generation and audit layer</strong><p>Server-side AI calls produce structured source artifacts. Solidity source is compiled with a restricted import resolver; Solana programs use an isolated build environment.</p></div>
          <div><strong>Data and authorization</strong><p>Supabase authentication, linked-wallet records, Postgres Row Level Security, owner-scoped project access, and idempotent transaction records.</p></div>
          <div><strong>Publishing</strong><p>Verified dApp frontends are packaged with their chain and deployed-contract metadata, pinned through Pinata, and served from IPFS gateways.</p></div>
        </div>
      </section>

      <section id="evm-flow">
        <div className="technical-kicker">03 / EVM deployment flow</div>
        <h2>User-signed contract creation</h2>
        <ol className="technical-steps">{evmFlow.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol>
        <div className="technical-code-fact"><span>Required deployment value</span><strong>0.001 native token</strong><span>Recipient</span><code>0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134</code></div>
        <p>The fee is atomic with deployment: the generated zero-argument payable constructor requires exactly 0.001 of the selected chain&apos;s native token (for example ETH, POL, AVAX, BNB, XDAI, CELO, MNT, BERA, S, FRAX, METIS, or HYPE), forwards it to the disclosed recipient, and emits <code>DappsterDeploymentFeePaid</code>. If the transfer fails, contract creation reverts. Network gas is separate and is displayed by the user&apos;s wallet.</p>
      </section>

      <section id="networks">
        <div className="technical-kicker">04 / Supported EVM networks</div>
        <h2>Explicit allowlist</h2>
        <div className="table-wrap"><table className="table technical-table"><thead><tr><th>Network</th><th>Chain ID</th><th>Environment</th></tr></thead><tbody>{evmNetworks.map(([network, id, environment]) => <tr key={id}><td><strong>{network}</strong></td><td><code>{id}</code></td><td>{environment}</td></tr>)}</tbody></table></div>
        <p>Each network is configured with an explicit chain ID, RPC endpoint set, and block explorer. Dappster rejects unsupported EVM chain IDs and verifies that the wallet switched to the selected network before submission.</p>
      </section>

      <section id="solana-flow">
        <div className="technical-kicker">05 / Solana deployment flow</div>
        <h2>Authorized, user-funded relayer</h2>
        <ol className="technical-steps">{solanaFlow.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol>
        <p>The technical wallet is an operational deployer, not an end-user wallet. Mainnet SOL needed for rent and deployment comes from the requesting user. Funding transactions are tied to one deployment job and cannot be reused for another job.</p>
      </section>

      <section id="payments">
        <div className="technical-kicker">06 / Payments and credits</div>
        <h2>On-chain settlement on Base</h2>
        <ul className="technical-checks">
          <li><CheckCircle2 size={16} /> Credit packages and membership settle in native Circle USDC on Base.</li>
          <li><CheckCircle2 size={16} /> The production membership contract is <a href="https://basescan.org/address/0xea7e37d45b6f75ae6826c1925d7b0ac314c7ecae" target="_blank" rel="noreferrer"><code>0xea7e37d45b6f75ae6826c1925d7b0ac314c7ecae</code></a>.</li>
          <li><CheckCircle2 size={16} /> The backend credits an account only after verifying the receipt and exact USDC transfer event.</li>
          <li><CheckCircle2 size={16} /> Credits are non-transferable ERC-1155 units. The normal product flow asks the linked user wallet to sign <code>burnOwnCredits</code>.</li>
          <li><CheckCircle2 size={16} /> Unique usage IDs and database payment references make purchases and credit consumption idempotent.</li>
        </ul>
      </section>

      <section id="controls">
        <div className="technical-kicker">07 / Security controls</div>
        <h2>Validation and access boundaries</h2>
        <div className="technical-grid">
          <div><strong>Input validation</strong><p>API payloads are schema-validated and size-limited. Solidity compilation restricts imports to the bundled OpenZeppelin contracts directory.</p></div>
          <div><strong>Wallet linkage</strong><p>Payment, credit, and deployment actions must use a wallet linked to the authenticated Dappster account.</p></div>
          <div><strong>Receipt verification</strong><p>Backend verification checks chain, sender where applicable, destination, amount, transaction success, emitted events, and deployment address before synchronizing state.</p></div>
          <div><strong>Database isolation</strong><p>Row Level Security limits private profiles, projects, audits, transactions, and deployment jobs to their owners. Public Marketplace access is limited to listed records and configured visibility.</p></div>
          <div><strong>Replay resistance</strong><p>Unique usage IDs, funding memos, job IDs, transaction references, and database uniqueness rules prevent reuse across actions.</p></div>
          <div><strong>Operational logging</strong><p>Client errors are accepted only from the same origin and logged with bounded fields; wallet secrets are not part of the telemetry payload.</p></div>
        </div>
      </section>

      <section id="trust-boundaries">
        <div className="technical-kicker">08 / Trust boundaries and limitations</div>
        <h2>What users must still verify</h2>
        <p>AI-generated code can contain defects. Compilation, transaction simulation, and automated audit output do not replace an independent professional security audit. Dappster presents generated source before deployment so users can inspect it and should test high-value applications on a test network first. Wallet simulation and security-warning vendors remain an additional independent protection layer.</p>
      </section>

      <section id="verification">
        <div className="technical-kicker">09 / Independent verification</div>
        <h2>Public references</h2>
        <dl className="technical-references">
          <div><dt>Production domain</dt><dd><a href="https://dappster.fun">https://dappster.fun</a></dd></div>
          <div><dt>Marketplace</dt><dd><a href="https://dappster.fun/explore">https://dappster.fun/explore</a></dd></div>
          <div><dt>Base membership contract</dt><dd><a href="https://basescan.org/address/0xea7e37d45b6f75ae6826c1925d7b0ac314c7ecae">BaseScan verification page</a></dd></div>
          <div><dt>Deployment fee recipient</dt><dd><a href="https://basescan.org/address/0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134"><code>0x5D69...6134</code></a></dd></div>
          <div><dt>Security contact</dt><dd><a href="mailto:dev@dappster.fun">dev@dappster.fun</a></dd></div>
        </dl>
      </section>
    </article>
  </div></section>
}
