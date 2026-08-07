import { NextResponse } from "next/server"
import { resolveDappsterPointsAddress } from "@/lib/dappster-points"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
}

export async function GET(_: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params
    const decodedAddress = decodeURIComponent(address)
    const { chain, entry } = await resolveDappsterPointsAddress(decodedAddress)
    return NextResponse.json({
      protocol: "Dappster",
      address: decodedAddress,
      addressType: chain === "evm" ? "evm" : "svm",
      points: entry?.points || 0,
      rank: entry?.rank || 0,
      publicApps: entry?.publicApps || 0,
      breakdown: entry?.breakdown || {},
      username: entry?.username || null,
      profileUrl: entry?.profileUrl ? `https://dappster.fun${entry.profileUrl}` : null,
    }, { headers: corsHeaders })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load Dappster Points" }, { status: 400, headers: corsHeaders })
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
