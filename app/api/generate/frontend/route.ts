import { NextResponse } from "next/server"
import { z } from "zod"
import type { Chain } from "@/types"
import { repairGeneratedFrontend } from "@/lib/ai"
import { CHAIN_IDS } from "@/lib/chain-adapters"
import { injectCompiledAbiIntoFrontend } from "@/lib/frontend-abi"
import { getSupportedEvmChain } from "@/lib/evm-chains"
import { localGetDapp, localUpdateDapp } from "@/lib/local-store"
import { enforceRateLimit } from "@/lib/rate-limit"
import { getRequestUser } from "@/lib/runtime"
import { compileSolidity } from "@/lib/solidity"
import { getDappSourceBundle, hydrateDappSources, storeDappSourceBundle } from "@/lib/source-storage"
import { supabaseRequest } from "@/lib/supabase"

export const maxDuration = 300

const requestSchema = z.object({
  dappId: z.string().uuid(),
  previewError: z.string().min(1).max(4000),
  evmChainId: z.number().int().positive().optional(),
})

type RepairableDapp = {
  id: string
  owner_id: string
  name: string
  description: string | null
  chain: Chain
  contract_code: string | null
  frontend_code: string | null
  contract_chain_id: number | null
  source_bundle_path: string | null
  source_bundle_hash: string | null
}

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = requestSchema.parse(await request.json())
    await enforceRateLimit(`frontend-repair:${user.id}`, 10)

    const localDapp = user.isDemo ? localGetDapp(input.dappId) : undefined
    const storedRows = user.isDemo
      ? []
      : await supabaseRequest<RepairableDapp[]>({
        path: "dapps",
        query: {
          id: `eq.${input.dappId}`,
          owner_id: `eq.${user.id}`,
          select: "id,owner_id,name,description,chain,contract_code,frontend_code,contract_chain_id,source_bundle_path,source_bundle_hash",
          limit: "1",
        },
      })
    const storedDapp = user.isDemo ? localDapp : storedRows[0]
    if (!storedDapp || storedDapp.owner_id !== user.id || !CHAIN_IDS.includes(storedDapp.chain as Chain)) {
      return NextResponse.json({ error: "dApp not found" }, { status: 404 })
    }
    const dapp = await hydrateDappSources(storedDapp)
    if (!dapp.contract_code || !dapp.frontend_code) throw new Error("This generated project is incomplete or unavailable")

    let frontend = await repairGeneratedFrontend({
      chain: dapp.chain as Chain,
      productPrompt: dapp.description || dapp.name,
      contractSource: dapp.contract_code,
      frontendSource: dapp.frontend_code,
      previewError: input.previewError,
    })
    if (dapp.chain === "evm") {
      const chainId = input.evmChainId || dapp.contract_chain_id || 8453
      if (!getSupportedEvmChain(chainId)) throw new Error("Unsupported EVM deployment network")
      frontend = injectCompiledAbiIntoFrontend(frontend, compileSolidity(dapp.contract_code, dapp.name, { chainId }).abi)
    }

    if (user.isDemo) {
      localUpdateDapp(input.dappId, { frontend_code: frontend })
    } else {
      const remoteDapp = dapp as RepairableDapp
      let sourceUpdates: Record<string, unknown> = { frontend_code: frontend }
      if (remoteDapp.source_bundle_path) {
        try {
          const previousBundle = await getDappSourceBundle(remoteDapp.source_bundle_path, remoteDapp.source_bundle_hash)
          const stored = await storeDappSourceBundle(user.id, dapp.id, {
            contract: dapp.contract_code,
            frontend,
            deployInstructions: previousBundle.deployInstructions,
            warnings: previousBundle.warnings,
          })
          sourceUpdates = {
            contract_code: null,
            frontend_code: null,
            source_bundle_path: stored.path,
            source_bundle_hash: stored.hash,
            source_bundle_bytes: stored.bytes,
            source_storage_version: 1,
          }
        } catch {
          // Preserve the repaired frontend in the legacy column if object storage
          // is temporarily unavailable. hydrateDappSources merges both sources.
        }
      }
      await supabaseRequest({
        path: "dapps",
        method: "PATCH",
        query: { id: `eq.${dapp.id}`, owner_id: `eq.${user.id}` },
        body: { ...sourceUpdates, updated_at: new Date().toISOString() },
      })
    }

    return NextResponse.json({ frontend })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not regenerate the frontend"
    const status = message.includes("Authentication") || message.includes("session") ? 401 : message.includes("Rate limit") ? 429 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
