"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Search } from "lucide-react"
import type { Dapp } from "@/types"
import { toDappCard } from "@/lib/dapp-card-data"
import type { PublicDapp } from "@/lib/public-dapps"
import { DappCard } from "./DappCard"
import { CHAIN_ADAPTERS, CHAIN_IDS } from "@/lib/chain-adapters"

export function ExploreGrid({ initialDapps, initialHasMore, initialMode }: {
  initialDapps: PublicDapp[]
  initialHasMore: boolean
  initialMode?: string
}) {
  const pageSize = 12
  const [chain, setChain] = useState("all")
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [dapps, setDapps] = useState<Dapp[]>(() => initialDapps.map(toDappCard))
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [page, setPage] = useState(1)
  const [error, setError] = useState("")
  const [demoMode, setDemoMode] = useState(initialMode === "local")
  const skipInitialRequest = useRef(true)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [query])

  useEffect(() => {
    if (skipInitialRequest.current && chain === "all" && !debouncedQuery) {
      skipInitialRequest.current = false
      return
    }
    skipInitialRequest.current = false
    const controller = new AbortController()
    const params = new URLSearchParams({ page: "1", limit: String(pageSize) })
    if (chain !== "all") params.set("chain", chain)
    if (debouncedQuery) params.set("q", debouncedQuery)
    setLoading(true)
    setError("")
    fetch(`/api/dapps?${params}`, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error("Marketplace unavailable")
      return response.json()
    }).then((payload: { dapps?: PublicDapp[]; mode?: string; hasMore?: boolean }) => {
      const live = (payload.dapps || []).map(toDappCard)
      setDapps(live)
      setPage(1)
      setHasMore(Boolean(payload.hasMore))
      setDemoMode(payload.mode === "local")
    }).catch(cause => {
      if (cause instanceof DOMException && cause.name === "AbortError") return
      setDapps([])
      setHasMore(false)
      setError("The Marketplace could not be loaded. Please try again.")
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [chain, debouncedQuery])

  async function loadMore() {
    if (loadingMore || !hasMore) return
    const nextPage = page + 1
    const params = new URLSearchParams({ page: String(nextPage), limit: String(pageSize) })
    if (chain !== "all") params.set("chain", chain)
    if (debouncedQuery) params.set("q", debouncedQuery)
    setLoadingMore(true)
    setError("")
    try {
      const response = await fetch(`/api/dapps?${params}`)
      if (!response.ok) throw new Error("Marketplace unavailable")
      const payload = await response.json() as { dapps?: PublicDapp[]; hasMore?: boolean }
      const additions = (payload.dapps || []).map(toDappCard)
      setDapps(current => Array.from(new Map([...current, ...additions].map(dapp => [dapp.id, dapp])).values()))
      setPage(nextPage)
      setHasMore(Boolean(payload.hasMore))
    } catch {
      setError("More dApps could not be loaded. Please try again.")
    } finally {
      setLoadingMore(false)
    }
  }

  return <>{demoMode && <div className="mode-notice">Demo Marketplace · Connect Supabase to publish community listings.</div>}<div className="filter-row"><div className="search-wrap"><Search className="search-icon" size={16} /><input className="input" type="search" aria-label="Search Marketplace" placeholder="Search dApps, descriptions and tags..." value={query} onChange={event => setQuery(event.target.value)} /></div><select className="select" aria-label="Filter Marketplace by ecosystem" value={chain} onChange={event => setChain(event.target.value)}><option value="all">All ecosystems</option>{CHAIN_IDS.map(id => <option value={id} key={id}>{CHAIN_ADAPTERS[id].name}</option>)}</select></div>{loading ? <div className="empty-state"><Loader2 className="animate-spin" /></div> : <div className="card-grid">{dapps.map(dapp => <DappCard dapp={dapp} key={dapp.id} />)}</div>}{error && <div className="marketplace-error" role="alert">{error}</div>}{!loading && !dapps.length && !error && <div className="empty-state"><p>No dApps match those filters.</p></div>}{!loading && hasMore && <div className="marketplace-pagination"><button type="button" className="btn btn-outline" onClick={loadMore} disabled={loadingMore}>{loadingMore ? <Loader2 className="animate-spin" size={15} /> : null}{loadingMore ? "Loading..." : "Load more dApps"}</button></div>}</>
}
