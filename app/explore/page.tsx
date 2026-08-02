import { ExploreGrid } from "@/components/ExploreGrid"

export const metadata = { title: "Dapp Marketplace — Dappster" }

export default function ExplorePage() {
  return <><section className="page-hero"><div className="container"><div className="section-label">{"// Dapp marketplace"}</div><h1>Discover what&apos;s onchain.</h1><p>Browse multi-chain dApps, source code, audits and verified Fast Deploy offers from independent developers.</p></div></section><section className="app-section"><div className="container"><ExploreGrid /></div></section></>
}
