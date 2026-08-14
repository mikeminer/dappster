"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowUpRight, Check, Clock3, Coins, Eye, EyeOff, Loader2, Plus, Rocket, Save, Sparkles, Trash2, UserRound, X } from "lucide-react"
import { apiFetch } from "@/lib/client-api"
import { ChainNetworkBadge } from "@/components/ChainNetworkBadge"
import { UsdcCheckoutButton } from "@/components/UsdcCheckoutButton"
import { resolveIpfsUrl } from "@/lib/ipfs"
import type { Chain } from "@/types"

type Project = { id: string; name: string; description?: string; chain: Chain; tags?: string[]; contract_address?: string; contract_tx_hash?: string; contract_chain_id?: number | null; contract_network?: "devnet" | "mainnet-beta" | null; deploy_status?: string; ipfs_hash?: string; ipfs_url?: string; is_listed?: boolean; audit_status?: string; updated_at?: string }
type CreditTransaction = { id: string; amount: number; type: "purchase" | "spend" | "bonus"; description?: string | null; created_at: string }
type TesterTier = { eligible: boolean; minimumUiAmount: number; balanceUiAmount: number; status: "eligible" | "ineligible" | "unavailable" }
type Workspace = { profile: { credits: number; plan: string; plan_expires_at?: string | null; username?: string; dappsterPoints?: number }; testerTiers?: { solana: TesterTier & { tokenSymbol: "PASTA"; mint: string }; evm: TesterTier & { tokenSymbol: "pappardelle"; tokenAddress: string } }; dapps: Project[]; creditTransactions?: CreditTransaction[]; marketplace?: { sales: number; creatorRevenueUsdc: number }; mode: "local" | "supabase" }

const DELETE_CONFIRMATION = "I PERMANENTLY DELETE THIS CREATION"

function transactionLabel(transaction: CreditTransaction) {
  if (transaction.description) return transaction.description
  if (transaction.type === "spend") return "Credits used"
  if (transaction.type === "bonus") return "Bonus credits"
  return transaction.amount === 0 ? "Membership activation" : "Credits purchased"
}

export function DashboardClient() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [error, setError] = useState("")
  const [updatingId, setUpdatingId] = useState("")
  const [username, setUsername] = useState("")
  const [savingUsername, setSavingUsername] = useState(false)
  const [usernameMessage, setUsernameMessage] = useState("")
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState("")
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    apiFetch<Workspace>("/api/me").then(payload => {
      let remembered: Project[] = []
      if (payload.mode === "local") {
        try {
          remembered = JSON.parse(localStorage.getItem("dappster-projects") || "[]") as Project[]
        } catch {
          localStorage.removeItem("dappster-projects")
        }
      } else {
        localStorage.removeItem("dappster-projects")
      }
      const merged = [...payload.dapps]
      for (const project of remembered) if (!merged.some(item => item.id === project.id)) merged.push(project)
      setWorkspace({ ...payload, dapps: merged.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")) })
      setUsername(payload.profile.username || "")
    }).catch(cause => setError(cause instanceof Error ? cause.message : "Could not load workspace"))
  }, [])

  useEffect(() => {
    if (!projectToDelete) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) setProjectToDelete(null)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [projectToDelete, deleting])

  const liveCount = useMemo(() => workspace?.dapps.filter(project => project.deploy_status === "live").length || 0, [workspace])
  const auditedCount = useMemo(() => workspace?.dapps.filter(project => project.audit_status === "completed").length || 0, [workspace])
  const solanaTester = workspace?.testerTiers?.solana
  const evmTester = workspace?.testerTiers?.evm
  const testerTierNames = [solanaTester?.eligible ? "Solana Tester" : null, evmTester?.eligible ? "EVM Tester" : null].filter(Boolean).join(" + ")
  const hasTesterTier = Boolean(testerTierNames)
  const testerStatusUnavailable = solanaTester?.status === "unavailable" || evmTester?.status === "unavailable"
  const hasActivePlan = hasTesterTier || Boolean(workspace?.profile.plan !== "free" && workspace?.profile.plan_expires_at && new Date(workspace.profile.plan_expires_at).getTime() > Date.now())

  async function toggleListing(project: Project) {
    try {
      setUpdatingId(project.id)
      setError("")
      const isListed = !project.is_listed
      await apiFetch(`/api/dapps/${project.id}`, { method: "PATCH", body: JSON.stringify({ is_listed: isListed, listing: project }) })
      setWorkspace(current => current ? { ...current, dapps: current.dapps.map(item => item.id === project.id ? { ...item, is_listed: isListed } : item) } : current)
      if (workspace?.mode === "local") {
        const remembered = JSON.parse(localStorage.getItem("dappster-projects") || "[]") as Project[]
        localStorage.setItem("dappster-projects", JSON.stringify(remembered.map(item => item.id === project.id ? { ...item, is_listed: isListed } : item)))
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update listing") }
    finally { setUpdatingId("") }
  }

  async function saveUsername(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      setSavingUsername(true)
      setError("")
      setUsernameMessage("")
      const result = await apiFetch<{ username: string }>("/api/me", { method: "PATCH", body: JSON.stringify({ username }) })
      setUsername(result.username)
      setWorkspace(current => current ? { ...current, profile: { ...current.profile, username: result.username } } : current)
      setUsernameMessage("Public username saved")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update username") }
    finally { setSavingUsername(false) }
  }

  function openDeleteConfirmation(project: Project) {
    setError("")
    setDeleteConfirmation("")
    setProjectToDelete(project)
  }

  function closeDeleteConfirmation() {
    if (deleting) return
    setProjectToDelete(null)
    setDeleteConfirmation("")
  }

  async function deleteProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!projectToDelete || deleteConfirmation !== DELETE_CONFIRMATION) return
    try {
      setDeleting(true)
      setError("")
      await apiFetch(`/api/dapps/${projectToDelete.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      })
      const deletedId = projectToDelete.id
      setWorkspace(current => current ? { ...current, dapps: current.dapps.filter(item => item.id !== deletedId) } : current)
      if (workspace?.mode === "local") {
        const remembered = JSON.parse(localStorage.getItem("dappster-projects") || "[]") as Project[]
        localStorage.setItem("dappster-projects", JSON.stringify(remembered.filter(item => item.id !== deletedId)))
      }
      setProjectToDelete(null)
      setDeleteConfirmation("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete dApp")
    } finally {
      setDeleting(false)
    }
  }

  if (!workspace && !error) return <div className="empty-state"><Loader2 className="animate-spin" /></div>
  return <>
    {workspace?.mode === "local" && <div className="mode-notice">Local workspace · Add Supabase credentials to sync projects across devices and enable public profiles.</div>}
    {error && <div className="error-box" style={{marginBottom:16}}>{error}</div>}
    <div className="stats-grid">
      <div className="stat"><div className="stat-label">Available credits</div><div className="stat-value acid">{workspace?.profile.credits ?? 0}</div></div>
      <div className="stat"><div className="stat-label">Dappster Points</div><div className="stat-value">{workspace?.profile.dappsterPoints ?? 0}</div><Link className="stat-link" href="/leaderboard">View leaderboard</Link></div>
      <div className="stat"><div className="stat-label">Total projects</div><div className="stat-value">{workspace?.dapps.length ?? 0}</div></div>
      <div className="stat"><div className="stat-label">Live deployments</div><div className="stat-value">{liveCount}</div></div>
      <div className="stat"><div className="stat-label">Creator revenue</div><div className="stat-value">{workspace?.marketplace?.creatorRevenueUsdc?.toFixed(2) || "0.00"} <small>USDC</small></div></div>
    </div>
    <section className="panel profile-panel"><div className="panel-head"><span className="panel-title"><UserRound size={15} aria-hidden="true" /> Public profile</span>{workspace?.profile.username && <span className="status"><span className="status-dot" /> @{workspace.profile.username}</span>}</div><form className="panel-body profile-form" onSubmit={saveUsername}><div><label className="form-label" htmlFor="public-username">Publisher username</label><input id="public-username" className="input" value={username} minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" required onChange={event => { setUsername(event.target.value); setUsernameMessage("") }} placeholder="your_username" /><small>This username appears as the publisher of every dApp owned by your linked account.</small></div><button className="btn btn-primary" type="submit" disabled={savingUsername || username === (workspace?.profile.username || "")}>{savingUsername ? <Loader2 className="animate-spin" size={15} /> : usernameMessage ? <Check size={15} /> : <Save size={15} />}{savingUsername ? "Saving..." : usernameMessage || "Save username"}</button></form></section>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,gap:16}}>
      <div><h2 style={{fontSize:20,margin:"0 0 5px"}}>Projects</h2><div style={{color:"#727a84",fontSize:12}}>Your latest AI-generated dApps.</div></div>
      <Link href="/build" className="btn btn-primary"><Plus size={15} /> New dApp</Link>
    </div>
    <div className="panel table-wrap"><table className="table dashboard-projects-table"><thead><tr><th>Project</th><th>Chain</th><th>Status</th><th>Visibility</th><th /></tr></thead><tbody>
      {workspace?.dapps.map(project => {
        const frontendIsLive = Boolean(project.ipfs_hash || project.ipfs_url)
        const resumeLabel = project.contract_address ? "Publish frontend" : "Deploy"
        const displayedContractNetwork = project.contract_network || (project.chain === "solana" && project.name === "Generating dApp" ? "devnet" : null)
        return <tr key={project.id}><td><strong style={{color:"white"}}>{project.name}</strong></td><td><ChainNetworkBadge chain={project.chain} chainId={project.contract_chain_id} contractNetwork={displayedContractNetwork} /></td><td>{frontendIsLive ? <a href={resolveIpfsUrl(project.ipfs_hash, project.ipfs_url)} target="_blank" rel="noreferrer" className="status"><span className="status-dot" /> Live on IPFS</a> : <span style={{color:"#8c939d",fontSize:11}}>{project.contract_address ? "Onchain · frontend pending" : "Ready to deploy"}</span>}</td><td><button type="button" role="switch" aria-checked={Boolean(project.is_listed)} className={`visibility-toggle ${project.is_listed ? "active" : ""}`} disabled={updatingId === project.id} onClick={() => toggleListing(project)}>{updatingId === project.id ? <Loader2 className="animate-spin" size={14} /> : project.is_listed ? <Eye size={14} /> : <EyeOff size={14} />}<span>{project.is_listed ? "Public" : "Private"}</span><i aria-hidden="true" /></button></td><td><div className="project-actions">{!frontendIsLive && <Link href={`/build?project=${encodeURIComponent(project.id)}`} className="project-deploy-link" aria-label={`${resumeLabel} ${project.name}`}><Rocket size={14} /><span>{resumeLabel}</span></Link>}<Link href={`/dapp/${project.id}`} aria-label={`Open ${project.name}`}><ArrowUpRight size={15} /></Link><button type="button" className="project-delete-button" aria-label={`Delete ${project.name}`} onClick={() => openDeleteConfirmation(project)}><Trash2 size={15} /></button></div></td></tr>
      })}
      {!workspace?.dapps.length && <tr><td colSpan={5}><div style={{padding:25,textAlign:"center",color:"#707883"}}>No projects yet. Start with one sentence.</div></td></tr>}
    </tbody></table></div>
    <details className="panel credit-history-panel">
      <summary className="panel-head credit-history-summary">
        <div>
          <div className="panel-title"><Clock3 size={15} aria-hidden="true" /> Credit history</div>
          <div className="credit-history-subtitle">Credits added to and consumed from your linked Dappster account.</div>
        </div>
        <span className="credit-history-count">Last {Math.min(workspace?.creditTransactions?.length || 0, 100)} transactions</span>
      </summary>
      <div className="table-wrap"><table className="table credit-history-table"><thead><tr><th>Date</th><th>Activity</th><th>Type</th><th>Credits</th></tr></thead><tbody>{workspace?.creditTransactions?.map(transaction => <tr key={transaction.id}><td><time dateTime={transaction.created_at}>{new Date(transaction.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time></td><td><strong>{transactionLabel(transaction)}</strong></td><td><span className={`credit-transaction-type ${transaction.type}`}>{transaction.type === "spend" ? "Consumed" : transaction.type === "bonus" ? "Bonus" : transaction.amount === 0 ? "Membership" : "Added"}</span></td><td><span className={`credit-transaction-amount ${transaction.amount > 0 ? "positive" : transaction.amount < 0 ? "negative" : "neutral"}`}>{transaction.amount > 0 ? "+" : ""}{transaction.amount}</span></td></tr>)}{!workspace?.creditTransactions?.length && <tr><td colSpan={4}><div className="credit-history-empty">No credit activity yet.</div></td></tr>}</tbody></table></div>
    </details>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16,marginTop:24}}>
      <div className="panel"><div className="panel-body" style={{display:"flex",gap:16,alignItems:"center"}}><div className="feature-icon" style={{margin:0}}><Coins size={19} /></div><div><strong style={{fontSize:13}}>Need more room?</strong><p style={{margin:"5px 0 0",color:"#757d87",fontSize:11}}>300 credits · 25 USDC on Base.</p></div><div style={{marginLeft:"auto"}}><UsdcCheckoutButton packageId="builder" className="btn btn-outline" label="Top up" /></div></div></div>
      <div className="panel"><div className="panel-body" style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}><div className="feature-icon" style={{margin:0}}><Sparkles size={19} /></div><div><strong style={{fontSize:13}}>{hasActivePlan ? "Current plan" : "Choose your plan"}</strong><p style={{margin:"5px 0 0",color:"#757d87",fontSize:11}}>{hasTesterTier ? `${testerTierNames} · token balance verified · unlimited matching-ecosystem generations and audits` : hasActivePlan ? `${workspace?.profile.plan} · until ${new Date(workspace!.profile.plan_expires_at!).toLocaleDateString()}` : testerStatusUnavailable ? "Token-holder status is temporarily unavailable. Your credits remain usable." : "No plan is active until you select and purchase one."}</p></div>{hasTesterTier ? <div style={{marginLeft:"auto",display:"flex",gap:8,flexWrap:"wrap"}}>{solanaTester?.eligible && <a href={`https://pump.fun/coin/${solanaTester.mint}`} target="_blank" rel="noreferrer" className="btn btn-outline">{solanaTester.balanceUiAmount.toLocaleString()} PASTA</a>}{evmTester?.eligible && <a href={`https://basescan.org/token/${evmTester.tokenAddress}`} target="_blank" rel="noreferrer" className="btn btn-outline">{evmTester.balanceUiAmount.toLocaleString()} pappardelle</a>}</div> : <Link href="/#pricing" className="btn btn-outline" style={{marginLeft:"auto"}}>{hasActivePlan ? "Plans" : "Choose"}</Link>}</div></div>
    </div>
    {projectToDelete && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeDeleteConfirmation() }}><div className="modal delete-project-modal" role="dialog" aria-modal="true" aria-labelledby="delete-project-title"><button type="button" className="credits-modal-close" aria-label="Close deletion confirmation" onClick={closeDeleteConfirmation} disabled={deleting}><X size={18} /></button><div className="delete-project-icon"><AlertTriangle size={23} /></div><h2 id="delete-project-title">Delete “{projectToDelete.name}”?</h2><p>This permanently removes the creation from your Dappster account and Marketplace. Deployed smart contracts and files already published to IPFS cannot be removed from the blockchain or IPFS network.</p><form onSubmit={deleteProject}><label className="form-label" htmlFor="delete-project-confirmation">Type this statement to confirm:</label><code>{DELETE_CONFIRMATION}</code><input id="delete-project-confirmation" className="input" value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} autoComplete="off" autoFocus spellCheck={false} placeholder={DELETE_CONFIRMATION} disabled={deleting} /><div className="delete-project-actions"><button type="button" className="btn btn-outline" onClick={closeDeleteConfirmation} disabled={deleting}>Cancel</button><button type="submit" className="btn btn-danger" disabled={deleting || deleteConfirmation !== DELETE_CONFIRMATION}>{deleting ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />}{deleting ? "Deleting..." : "Delete permanently"}</button></div></form></div></div>}
  </>
}
