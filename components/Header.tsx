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
          <div className="nav-brand-group">
            <Logo />
            <a
              className="devfridge-header-badge"
              href="https://scan.devfridge.cool/t/39kMeX4HVRW9qbbiHSPbRQ9xeXUF18GrNP6gL61Ppump"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open the live DevFridge scan for $PASTA"
              title="View the live $PASTA DevFridge scan"
            >
              {/* The scanner serves a live SVG, so it intentionally bypasses image optimization and caching. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://scan.devfridge.cool/api/badge?mint=39kMeX4HVRW9qbbiHSPbRQ9xeXUF18GrNP6gL61Ppump&theme=light&style=full"
                alt="$PASTA DevFridge verification and lock status"
                width="176"
                height="28"
              />
            </a>
          </div>
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
