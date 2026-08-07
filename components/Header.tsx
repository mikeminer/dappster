"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard } from "lucide-react"
import { Logo } from "./Logo"
import { ConnectWalletIsland } from "./ConnectWalletIsland"

const links = [
  ["/build", "Build"],
  ["/explore", "Marketplace"],
  ["/leaderboard", "Leaderboard"],
  ["/audit", "Audit"],
  ["/#pricing", "Pricing"],
]

export function Header() {
  const pathname = usePathname()

  return (
      <header className="nav">
        <div className="container nav-inner">
          <Logo />
          <nav className="nav-links" aria-label="Primary navigation">
            {links.map(([href, label]) => <Link key={href} className={pathname === href ? "active" : ""} href={href}>{label}</Link>)}
          </nav>
          <div className="nav-actions">
            <Link href="/dashboard" className="btn btn-ghost dashboard-link" aria-label="Open dashboard"><LayoutDashboard size={16} aria-hidden="true" /><span>Dashboard</span></Link>
            <ConnectWalletIsland />
          </div>
        </div>
      </header>
  )
}
