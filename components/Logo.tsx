import Link from "next/link"

export function Logo() {
  return (
    <Link href="/" className="brand" aria-label="Dappster home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="28" height="28" fill="none"><path d="M7 5h10.4C23.8 5 27 8.9 27 15.8 27 23 23.2 27 16.7 27H7V5Z" stroke="currentColor" strokeWidth="3"/><path d="M13 11h4.1c2.6 0 4 1.8 4 4.8 0 3.3-1.6 5.2-4.2 5.2H13V11Z" fill="currentColor"/></svg>
      </span>
      <span>dappster<span className="brand-dot">.</span></span>
    </Link>
  )
}
