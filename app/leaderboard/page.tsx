import Link from "next/link"
import { Search, Trophy } from "lucide-react"
import { getDappsterLeaderboard } from "@/lib/dappster-points"

export const metadata = { title: "Dappster Points Leaderboard — Dappster" }
export const revalidate = 60

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  const search = params.q?.trim() || ""
  const leaderboard = await getDappsterLeaderboard({ page, limit: 25, search })
  const pageHref = (nextPage: number) => `/leaderboard?page=${nextPage}${search ? `&q=${encodeURIComponent(search)}` : ""}`

  return <>
    <section className="page-hero"><div className="container"><div className="section-label">{"// Dappster Points"}</div><h1>Builders who ship.</h1><p>One point equals one unique dApp that is deployed onchain, published to IPFS, and currently public in the Dappster Marketplace.</p></div></section>
    <section className="app-section"><div className="container form-stack">
      <div className="points-summary"><Trophy size={22} aria-hidden="true" /><div><strong>{leaderboard.totalPoints} live Dappster Points</strong><span>Points automatically disappear when a dApp is made private or deleted, and return when it is published again.</span></div></div>
      <form className="leaderboard-search" action="/leaderboard" method="get"><Search size={16} aria-hidden="true" /><input className="input" type="search" name="q" defaultValue={search} placeholder="Search creator or wallet" aria-label="Search leaderboard" /><button className="btn btn-outline" type="submit">Search</button></form>
      <div className="panel table-wrap"><table className="table leaderboard-table"><thead><tr><th>Rank</th><th>Creator</th><th>Dappster Points</th><th>Ecosystems</th><th /></tr></thead><tbody>{leaderboard.entries.map(entry => <tr key={entry.accountId}><td><strong className="leaderboard-rank">#{entry.rank}</strong></td><td><strong>{entry.displayName}</strong><small>{entry.wallets[0] ? `${entry.wallets[0].address.slice(0, 8)}…${entry.wallets[0].address.slice(-6)}` : "Verified Dappster account"}</small></td><td><span className="points-total">{entry.points}</span></td><td><div className="leaderboard-breakdown">{Object.entries(entry.breakdown).map(([chain, count]) => <span className="tag" key={chain}>{chain} · {count}</span>)}</div></td><td>{entry.profileUrl ? <Link className="btn btn-outline" href={entry.profileUrl}>View profile</Link> : entry.firstDappId ? <Link className="btn btn-outline" href={`/dapp/${entry.firstDappId}`}>View app</Link> : null}</td></tr>)}{!leaderboard.entries.length && <tr><td colSpan={5}><div className="empty-state">No creators match this search.</div></td></tr>}</tbody></table></div>
      {leaderboard.totalPages > 1 && <nav className="leaderboard-pagination" aria-label="Leaderboard pages"><Link className={`btn btn-outline ${page <= 1 ? "disabled" : ""}`} aria-disabled={page <= 1} href={page > 1 ? pageHref(page - 1) : pageHref(1)}>Previous</Link><span>Page {page} of {leaderboard.totalPages}</span><Link className={`btn btn-outline ${page >= leaderboard.totalPages ? "disabled" : ""}`} aria-disabled={page >= leaderboard.totalPages} href={page < leaderboard.totalPages ? pageHref(page + 1) : pageHref(leaderboard.totalPages)}>Next</Link></nav>}
    </div></section>
  </>
}
