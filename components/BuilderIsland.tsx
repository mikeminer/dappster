"use client"

import dynamic from "next/dynamic"

export const BuilderIsland = dynamic(
  () => import("@/components/BuilderRuntime").then(module => module.BuilderRuntime),
  {
    ssr: false,
    loading: () => <div className="panel"><div className="panel-body"><p>Loading the multichain builder…</p></div></div>,
  },
)
