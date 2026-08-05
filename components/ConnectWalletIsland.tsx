"use client"

import dynamic from "next/dynamic"

const ConnectWalletRuntime = dynamic(
  () => import("@/components/ConnectWalletRuntime").then(module => module.ConnectWalletRuntime),
  { ssr: false, loading: () => <button className="btn btn-outline" type="button" disabled aria-live="polite">Loading wallet…</button> },
)

export function ConnectWalletIsland(props: { mode?: "button" | "panel"; redirectTo?: string }) {
  return <ConnectWalletRuntime {...props} redirectTo={props.redirectTo || "/dashboard"} />
}
