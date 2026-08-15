"use client"

import dynamic from "next/dynamic"

export const DappDetailIsland = dynamic(
  () => import("@/components/DappDetailRuntime").then(module => module.DappDetailRuntime),
  { ssr: false, loading: () => <div className="empty-state">Loading dApp…</div> },
)
