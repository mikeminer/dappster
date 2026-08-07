import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { SocialShare } from "@/components/SocialShare"
import { ChainNetworkBadge } from "@/components/ChainNetworkBadge"
import type { Dapp } from "@/types"

export function DappCard({ dapp }: { dapp: Dapp }) {
  return (
    <article className="dapp-card">
      <Link href={`/dapp/${dapp.id}`} className="dapp-card-link">
        <div className="dapp-top">
          <div className={`dapp-icon accent-${dapp.accent}`}>{dapp.icon}</div>
          <ChainNetworkBadge chain={dapp.chain} chainId={dapp.chainId} contractNetwork={dapp.contractNetwork} />
        </div>
        <h3>{dapp.name}</h3>
        <p>{dapp.description}</p>
      </Link>
      <div className="dapp-meta"><div className="tags">{dapp.tags.slice(0, 2).map(tag => <span className="tag" key={tag}>{tag}</span>)}</div><div className="dapp-publisher"><span className="points-pill">{dapp.ownerPoints || 0} pts</span>{dapp.ownerUsername ? <Link className="owner" href={`/creator/${encodeURIComponent(dapp.ownerUsername)}`}>{dapp.owner}</Link> : <span className="owner">{dapp.owner}</span>}</div></div>
      <div className="dapp-card-actions"><Link href={`/dapp/${dapp.id}`} className="btn btn-outline">Details</Link><SocialShare dappId={dapp.id} dappName={dapp.name} />{dapp.ipfsUrl && <a href={dapp.ipfsUrl} target="_blank" rel="noreferrer" className="btn btn-primary dapp-ipfs-action">View on IPFS <ExternalLink size={14} aria-hidden="true" /></a>}</div>
    </article>
  )
}
