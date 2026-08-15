import { ExploreGrid } from "@/components/ExploreGrid"
import { getCachedPublicDapps } from "@/lib/public-dapps"

export const metadata = { title: "Dapp Marketplace — Dappster" }
export const revalidate = 3600

export default async function ExplorePage() {
  const initial = await getCachedPublicDapps({ page: 1, limit: 12 })
    .catch(() => ({ dapps: [], hasMore: false, mode: undefined }))
  return <><section className="page-hero"><div className="container"><div className="section-label">{"// Dapp marketplace"}</div><h1>Discover what&apos;s onchain.</h1><p>Browse multi-chain dApps, source code, audits and verified Fast Deploy offers from independent developers.</p></div></section><section className="app-section"><div className="container"><ExploreGrid initialDapps={initial.dapps} initialHasMore={initial.hasMore} initialMode={initial.mode} /></div></section></>
}
