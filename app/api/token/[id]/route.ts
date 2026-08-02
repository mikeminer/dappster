import { NextResponse } from "next/server"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const membership = id === "2"
  return NextResponse.json({
    name: membership ? "Dappster Monthly Membership" : "Dappster Credits",
    description: membership ? "Non-transferable Dappster membership, renewed in 30-day periods." : "Non-transferable credits minted on purchase and burned when Dappster services are consumed.",
    decimals: 0,
    properties: { soulbound: true, network: "Base" },
  })
}
