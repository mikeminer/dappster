import { NextResponse } from "next/server"
import { getDappsterLeaderboard } from "@/lib/dappster-points"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const payload = await getDappsterLeaderboard({
      page: Number(url.searchParams.get("page")) || 1,
      limit: Number(url.searchParams.get("limit")) || 25,
      search: url.searchParams.get("q") || "",
    })
    return NextResponse.json({
      ...payload,
      entries: payload.entries.map(({ accountId: _accountId, wallets, ...entry }) => ({
        ...entry,
        wallet: wallets[0] || null,
      })),
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Leaderboard unavailable" }, { status: 500 })
  }
}
