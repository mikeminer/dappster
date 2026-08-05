import Link from "next/link"
import { Github } from "lucide-react"
import { Logo } from "./Logo"

export function Footer() {
  return <footer className="footer"><div className="container footer-inner"><Logo /><div>© 2026 Dappster. Build carefully. Ship boldly.</div><div className="footer-links"><Link href="/explore">Marketplace</Link><Link href="/audit">Audit</Link><Link href="/technical-overview">Technical overview</Link><Link href="/trust">Trust &amp; security</Link><a href="https://github.com/mikeminer/dappster" target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:6}}><Github size={14} aria-hidden="true" /> GitHub</a></div></div></footer>
}
