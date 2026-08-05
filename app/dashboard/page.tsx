import { DashboardClient } from "@/components/DashboardClient"

export const metadata = { title: "Dashboard — Dappster" }
export const dynamic = "force-dynamic"

export default function DashboardPage() {
  return <><section className="page-hero"><div className="container"><div className="section-label">{"// Workspace"}</div><h1>Your builds.</h1><p>Manage generated projects, deployments, audits, and credits.</p></div></section><section className="app-section"><div className="container"><DashboardClient /></div></section></>
}
