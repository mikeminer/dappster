"use client"

import dynamic from "next/dynamic"

export const AuditToolIsland = dynamic(
  () => import("@/components/AuditTool").then(module => module.AuditTool),
  {
    ssr: false,
    loading: () => <div className="panel"><div className="panel-body"><p>Loading the security scanner…</p></div></div>,
  },
)
