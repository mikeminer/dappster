import Link from "next/link"
import { ArrowRight, Bot, Check, CloudUpload, Code2, Flame, ShieldCheck, Sparkles, Wallet } from "lucide-react"
import { DappCard } from "@/components/DappCard"
import { UsdcCheckoutButton } from "@/components/UsdcCheckoutButton"
import { toDappCard } from "@/lib/dapp-card-data"
import { getPublicDapps } from "@/lib/public-dapps"

export const dynamic = "force-dynamic"

export default async function Home() {
  const publishedDapps = await getPublicDapps({ limit: 3 })
    .then(result => result.dapps.map(toDappCard))
    .catch(() => [])
  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <div className="eyebrow"><span className="eyebrow-dot" /> AI-native dApp development</div>
          <h1>From prompt to <span>protocol.</span></h1>
          <p className="hero-copy">Create production-ready smart contracts and interfaces for EVM and Solana. Deploy to IPFS, audit your code, and share it with the world.</p>
          <div className="hero-actions">
            <Link href="/build" className="btn btn-primary btn-lg"><Sparkles size={17} /> Start building</Link>
            <Link href="/explore" className="btn btn-outline btn-lg">Open Marketplace <ArrowRight size={17} /></Link>
          </div>
          <div className="hero-proof"><div className="proof-avatars"><span className="proof-avatar" style={{background:"#9b6cff"}}>M</span><span className="proof-avatar" style={{background:"#55d6a6"}}>A</span><span className="proof-avatar" style={{background:"#f29b52"}}>S</span><span className="proof-avatar" style={{background:"#62a8ff"}}>J</span></div><span>Join builders shipping onchain, faster.</span></div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading"><div><div className="section-label">// The workflow</div><h2 className="section-title">Idea in. dApp out.</h2></div><p className="section-copy">One focused workspace for the full dApp lifecycle—from your first sentence to a public, decentralized product.</p></div>
          <div className="feature-grid">
            <article className="feature"><span className="feature-number">01</span><div className="feature-icon"><Bot size={21} /></div><h3>Describe &amp; build</h3><p>Tell Dappster what you want. Get a complete smart contract and React interface built for your chain.</p><div className="feature-glow" /></article>
            <article className="feature"><span className="feature-number">02</span><div className="feature-icon"><CloudUpload size={21} /></div><h3>Deploy anywhere</h3><p>Ship your frontend to IPFS in one click. Own the output and deploy the contract with your wallet.</p><div className="feature-glow" /></article>
            <article className="feature"><span className="feature-number">03</span><div className="feature-icon"><ShieldCheck size={21} /></div><h3>Audit with confidence</h3><p>Find vulnerabilities, understand the impact, and apply precise fixes before you touch mainnet.</p><div className="feature-glow" /></article>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading"><div><div className="section-label">// Built on Dappster</div><h2 className="section-title">Fresh from the chain.</h2></div><Link href="/explore" className="btn btn-outline">Open Marketplace <ArrowRight size={15} /></Link></div>
          {publishedDapps.length
            ? <div className="card-grid">{publishedDapps.map(dapp => <DappCard dapp={dapp} key={dapp.id} />)}</div>
            : <div className="empty-state"><p>No published dApps yet.</p><Link href="/build" className="btn btn-primary">Publish the first dApp</Link></div>}
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="container">
          <div className="section-heading"><div><div className="section-label">// Credits and membership</div><h2 className="section-title">Build more. Pay less.</h2></div><p className="section-copy">Buy Dappster Credits or activate Pro, paying exclusively in USDC on Base. No card required.</p></div>
          <div className="pricing-grid">
            <article className="price-card"><div className="price-name">Just Check</div><div className="price">5 <small>USDC</small></div><p>Buy 50 Dappster Credits for exploring ideas and shipping your first dApp.</p><ul className="feature-list"><li>50 credits</li><li>10 AI generations</li><li>Public Marketplace listing</li><li>EVM and Solana support</li></ul><UsdcCheckoutButton packageId="starter" className="btn btn-outline btn-block" label="Buy 50 credits" /></article>
            <article className="price-card featured"><div className="popular">MOST POPULAR</div><div className="price-name">Builder</div><div className="price">25 <small>USDC</small></div><p>Buy 300 Dappster Credits for serious shipping.</p><ul className="feature-list"><li>60 AI generations</li><li>12 premium audits</li><li>IPFS deployments</li><li>USDC payment on Base</li></ul><UsdcCheckoutButton packageId="builder" className="btn btn-primary btn-block" label="Buy 300 credits" /></article>
            <article className="price-card"><div className="price-name">Pro</div><div className="price">39 <small>USDC / 30 days</small></div><p>Unlimited creative room for power builders. Renew from your wallet every 30 days.</p><ul className="feature-list"><li>Unlimited generations</li><li>20 premium audits / month</li><li>Featured listing credit</li><li>USDC on Base · no card</li></ul><UsdcCheckoutButton packageId="unlimited" className="btn btn-outline btn-block" label="Activate Pro" /></article>
          </div>
          <section className="credit-burn-guide" aria-labelledby="credit-burn-title">
            <div className="credit-burn-head">
              <div><div className="section-label">// Exact usage costs</div><h3 id="credit-burn-title">How credits are burned</h3></div>
              <p>Credits are ERC-1155 assets on Base. Every paid action is authorized and burned directly by your linked EVM wallet before Dappster starts the work.</p>
            </div>
            <div className="credit-burn-table-wrap">
              <table className="credit-burn-table">
                <thead><tr><th>Action</th><th>Credits burned</th><th>Authorization</th></tr></thead>
                <tbody>
                  <tr><td><strong>Generate a dApp</strong><span>EVM or Solana project</span></td><td><b>5</b></td><td>Base wallet signature</td></tr>
                  <tr><td><strong>Basic security audit</strong><span>AI contract review</span></td><td><b>15</b></td><td>Base wallet signature</td></tr>
                  <tr><td><strong>Premium security audit</strong><span>New or deployed contract</span></td><td><b>25</b></td><td>Base wallet signature</td></tr>
                  <tr><td><strong>Publish frontend to IPFS</strong><span>After contract or program confirmation</span></td><td><b>2</b></td><td>Base wallet signature</td></tr>
                  <tr><td><strong>Deploy contract or Solana program</strong><span>Network and deployment fees are separate</span></td><td><b className="zero-burn">0</b></td><td>No credit burn</td></tr>
                </tbody>
              </table>
            </div>
            <div className="credit-burn-rules">
              <div><Wallet size={18} /><p><strong>You sign every burn</strong><span>The technical wallet cannot burn your credits. You approve <code>burnOwnCredits</code> and pay the small Base gas fee.</span></p></div>
              <div><Flame size={18} /><p><strong>Burn first, then run</strong><span>Dappster verifies the exact amount, linked wallet and unique usage ID before starting the action.</span></p></div>
              <div><Check size={18} /><p><strong>One balance across chains</strong><span>Solana actions use the same account, but their credits are still burned from your linked EVM wallet on Base.</span></p></div>
            </div>
            <div className="credit-pro-note"><strong>Active Pro membership</strong><span>No credit burn is required while Pro is active. Normal Base gas and deployment-network fees may still apply.</span></div>
          </section>
        </div>
      </section>

      <section className="cta-section"><div className="container"><div className="section-label">// Your move</div><h2>What will you put onchain?</h2><p>The next protocol starts with one sentence.</p><Link href="/build" className="btn btn-primary btn-lg"><Code2 size={18} /> Open the builder</Link></div></section>
    </>
  )
}
