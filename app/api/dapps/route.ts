import { NextResponse } from "next/server"
import { z } from "zod"
import { CHAIN_IDS } from "@/lib/chain-adapters"
import { getRequestUser } from "@/lib/runtime"
import { localCreateDapp } from "@/lib/local-store"
import { supabaseRequest } from "@/lib/supabase"
import { getPublicDapps } from "@/lib/public-dapps"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1)
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 12))
    const chain = url.searchParams.get("chain")
    const payload = await getPublicDapps({
      page,
      limit,
      chain,
      featured: url.searchParams.get("featured") === "true",
      tags: url.searchParams.get("tags"),
      search: url.searchParams.get("q"),
    })
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Directory unavailable" }, { status: 500 }) }
}

const createSchema = z.object({ name: z.string().min(2).max(80), description: z.string().max(600).optional(), chain: z.enum(CHAIN_IDS), tags: z.array(z.string().max(30)).max(6).optional() })

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = createSchema.parse(await request.json())
    if (user.isDemo) {
      const dapp = localCreateDapp({ owner_id: user.id, name: input.name, description: input.description || "", chain: input.chain, tags: input.tags || [], contract_code: "", frontend_code: "", deploy_status: "draft", is_listed: false, is_featured: false, audit_status: "none" })
      return NextResponse.json([dapp], { status: 201 })
    }
    const rows = await supabaseRequest({ path: "dapps", method: "POST", body: { ...input, owner_id: user.id } })
    return NextResponse.json(rows, { status: 201 })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create dApp" }, { status: 400 }) }
}
