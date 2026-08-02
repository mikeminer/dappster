"use client"

import dynamic from "next/dynamic"

export const ConnectButtonNoSSR = dynamic(
  () => import("@/components/ConnectButton").then(module => module.ConnectButton),
  { ssr: false },
)
