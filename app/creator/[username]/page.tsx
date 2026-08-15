import { notFound } from "next/navigation"
import { DappCard } from "@/components/DappCard"
import { toDappCard } from "@/lib/dapp-card-data"
import { getCreatorPointsProfile } from "@/lib/dappster-points"

export const revalidate = 60

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  return { title: `@${decodeURIComponent(username)} — Dappster creator` }
}

export default async function CreatorProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const profile = await getCreatorPointsProfile(decodeURIComponent(username))
  if (!profile) notFound()
  const cards = profile.dapps.map(dapp => toDappCard({
    ...dapp,
    ipfs_hash: dapp.ipfs_hash || undefined,
    ipfs_url: dapp.ipfs_url || undefined,
    publisher_name: profile.entry.displayName,
    publisher_username: profile.entry.username,
    publisher_points: profile.entry.points,
  }))

  return <>
    <section className="page-hero"><div className="container"><div className="section-label">{"// Creator profile"}</div><h1>@{profile.entry.username}</h1><p>{profile.entry.points} Dappster Points from verified public deployments.</p></div></section>
    <section className="app-section"><div className="container form-stack"><div className="creator-profile-summary"><div><span className="stat-label">Dappster Points</span><strong>{profile.entry.points}</strong></div><div><span className="stat-label">Public dApps</span><strong>{profile.entry.publicApps}</strong></div><div className="creator-breakdown">{Object.entries(profile.entry.breakdown).map(([chain, count]) => <span className="tag" key={chain}>{chain} · {count}</span>)}</div></div><div className="card-grid">{cards.map(dapp => <DappCard key={dapp.id} dapp={dapp} />)}</div></div></section>
  </>
}
