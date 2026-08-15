import { NextResponse } from "next/server"
import { z } from "zod"
import { compileMovePackage } from "@/lib/move-compiler"
import { getRequestUser } from "@/lib/runtime"
import { localGetDapp, localUpdateDapp } from "@/lib/local-store"
import { supabaseRequest } from "@/lib/supabase"
import { repairGeneratedContract } from "@/lib/ai"
import { enforceRateLimit } from "@/lib/rate-limit"
import { hydrateDappSources } from "@/lib/source-storage"

export const runtime = "nodejs"
export const maxDuration = 300

const schema = z.discriminatedUnion("chain", [
  z.object({ chain: z.literal("sui"), dappId: z.string().uuid(), publisher: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
  z.object({ chain: z.literal("aptos"), dappId: z.string().uuid(), publisher: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/) }),
])

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = schema.parse(await request.json())
    const localDapp = user.isDemo ? localGetDapp(input.dappId) : undefined
    if (localDapp && localDapp.owner_id !== user.id) throw new Error("Move dApp source not found")
    const rows = user.isDemo ? [] : await supabaseRequest<Array<{ chain: string; contract_code: string | null; source_bundle_path: string | null; source_bundle_hash: string | null }>>({
      path: "dapps",
      query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}`, select: "chain,contract_code,source_bundle_path,source_bundle_hash", limit: "1" },
    })
    const dapp = localDapp || (rows[0] ? await hydrateDappSources(rows[0]) : undefined)
    if (!dapp || dapp.chain !== input.chain || !dapp.contract_code) throw new Error("Move dApp source not found")
    try {
      return NextResponse.json(await compileMovePackage({ chain: input.chain, source: dapp.contract_code, publisher: input.publisher }))
    } catch (error) {
      const compilerError = error instanceof Error ? error.message : "Unknown Move compilation error"
      if (/COMPILER_SNAPSHOT_ID/.test(compilerError)) throw error
      if (!/(?:Sui|Aptos) Move compilation failed/.test(compilerError)) throw error
      await enforceRateLimit(`compile-repair:${user.id}:${input.chain}`, 3)
      const repairedSource = await repairGeneratedContract(input.chain, dapp.contract_code, compilerError)
      await compileMovePackage({ chain: input.chain, source: repairedSource, publisher: input.publisher })
      if (user.isDemo) localUpdateDapp(input.dappId, { contract_code: repairedSource })
      else await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}` }, body: { contract_code: repairedSource, updated_at: new Date().toISOString() } })
      return NextResponse.json({ status: "repaired", repairedSource })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Move compilation failed"
    const unavailable = /COMPILER_SNAPSHOT_ID/.test(message)
    return NextResponse.json({ error: message }, { status: unavailable ? 503 : 400 })
  }
}
