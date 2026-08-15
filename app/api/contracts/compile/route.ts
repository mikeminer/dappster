import { NextResponse } from "next/server"
import { z } from "zod"
import { compileSolidity } from "@/lib/solidity"
import { getRequestUser } from "@/lib/runtime"
import { localGetDapp } from "@/lib/local-store"
import { localUpdateDapp } from "@/lib/local-store"
import { supabaseRequest } from "@/lib/supabase"
import { assertRequiredDeploymentFee } from "@/lib/deployment-fee"
import { getSupportedEvmChain } from "@/lib/evm-chains"
import { repairEvmContract } from "@/lib/ai"
import { enforceRateLimit } from "@/lib/rate-limit"
import { hydrateDappSources } from "@/lib/source-storage"

export const runtime = "nodejs"

const schema = z.object({
  dappId: z.string().uuid(),
  contractCode: z.string().min(20).max(120000).optional(),
  contractName: z.string().regex(/^[A-Za-z_$][\w$]*$/).optional(),
  chainId: z.number().int().positive(),
})

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = schema.parse(await request.json())
    if (!getSupportedEvmChain(input.chainId)) throw new Error("Unsupported EVM deployment network")
    const localDapp = user.isDemo ? localGetDapp(input.dappId) : undefined
    const rows = user.isDemo ? [] : await supabaseRequest<{ contract_code: string | null; name: string; source_bundle_path: string | null; source_bundle_hash: string | null }[]>({
      path: "dapps",
      query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}`, select: "contract_code,name,source_bundle_path,source_bundle_hash", limit: "1" },
    })
    if (!user.isDemo && !rows[0]) throw new Error("dApp not found")
    const storedDapp = rows[0] ? await hydrateDappSources(rows[0]) : undefined
    const contractCode = localDapp?.contract_code || storedDapp?.contract_code || input.contractCode
    const contractName = input.contractName || localDapp?.name || storedDapp?.name
    if (!contractCode) throw new Error("Generated contract not found")
    assertRequiredDeploymentFee(contractCode)
    try {
      return NextResponse.json(compileSolidity(contractCode, contractName, { chainId: input.chainId }))
    } catch (error) {
      await enforceRateLimit(`compile-repair:${user.id}`, 3)
      const compilerError = error instanceof Error ? error.message : "Unknown Solidity compilation error"
      const repairedSource = await repairEvmContract(contractCode, compilerError)
      assertRequiredDeploymentFee(repairedSource)
      const artifact = compileSolidity(repairedSource, contractName, { chainId: input.chainId })
      if (user.isDemo) localUpdateDapp(input.dappId, { contract_code: repairedSource })
      else await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}` }, body: { contract_code: repairedSource, updated_at: new Date().toISOString() } })
      return NextResponse.json({ ...artifact, repairedSource })
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Compilation failed" }, { status: 400 })
  }
}
