import Link from "next/link"
import { Logo } from "./Logo"

export function Footer() {
  return <footer className="footer"><div className="container footer-inner"><Logo /><div>© 2026 Dappster. Build carefully. Ship boldly.</div><div className="footer-links"><Link href="/explore">Marketplace</Link><Link href="/audit">Audit</Link><Link href="/technical-overview">Technical overview</Link><Link href="/trust">Trust &amp; security</Link></div></div></footer>
}
