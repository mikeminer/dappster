"use client"

import dynamic from "next/dynamic"
import type { PackageId } from "@/lib/payments"

const CheckoutButton = dynamic(
  () => import("@/components/UsdcCheckoutButton").then(module => module.UsdcCheckoutButton),
  { ssr: false },
)

export function UsdcCheckoutIsland({ packageId, className = "btn btn-primary", label }: {
  packageId: PackageId
  className?: string
  label?: string
}) {
  return <CheckoutButton packageId={packageId} className={className} label={label} />
}
