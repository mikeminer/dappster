import { MembershipDeployer } from "@/components/MembershipDeployer"

export default function MembershipAdminPage() {
  return <><section className="page-hero"><div className="container"><div className="section-label">// Protocol deployment</div><h1>Membership contracts.</h1><p>Owner-only deployment console for the Dappster payment protocol.</p></div></section><section className="app-section"><div className="container"><MembershipDeployer /></div></section></>
}
