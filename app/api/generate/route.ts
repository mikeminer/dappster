import { NextResponse } from "next/server"
import { z } from "zod"
import { callAI } from "@/lib/ai"
import { assertCredits, CREDIT_COSTS, getCredits, hasActivePro } from "@/lib/credits"
import { creditBurnProofSchema, verifyAndSpendCreditBurn } from "@/lib/credit-burn"
import { enforceRateLimit } from "@/lib/rate-limit"
import { getRequestUser } from "@/lib/runtime"
import { localCreateDapp, localCredits, localGetDapp, localSpend, localUpdateDapp } from "@/lib/local-store"
import { supabaseRequest } from "@/lib/supabase"
import { getSupportedEvmChain } from "@/lib/evm-chains"
import { compileSolidity } from "@/lib/solidity"
import { injectCompiledAbiIntoFrontend } from "@/lib/frontend-abi"
import { CHAIN_IDS, getChainAdapter } from "@/lib/chain-adapters"
import { claimGenerationJob, completeGenerationJob, createOrGetGenerationJob, failGenerationJob, markGenerationJobCharged } from "@/lib/ai-generation-jobs"
import { hydrateDappSources, storeDappSourceBundle } from "@/lib/source-storage"

export const maxDuration = 300

const requestSchema = z.object({ prompt: z.string().min(12).max(4000), chain: z.enum(CHAIN_IDS), evmChainId: z.number().int().positive().optional(), includeAudit: z.boolean().optional().default(false), creditBurn: creditBurnProofSchema.optional(), dappId: z.string().uuid().optional() })

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = requestSchema.parse(await request.json())
    const profile = user.isDemo
      ? { credits: localCredits(user.id), plan: "free" }
      : input.creditBurn ? await getCredits(user.id) : await assertCredits(user.id, CREDIT_COSTS.generate)
    const activePro = hasActivePro(profile)
    if (!activePro && profile.credits < CREDIT_COSTS.generate && !input.creditBurn) throw new Error(`You need ${CREDIT_COSTS.generate} credits for this action`)
    await enforceRateLimit(`generate:${user.id}`, activePro ? 60 : 10)

    const evmChain = input.chain === "evm" ? getSupportedEvmChain(input.evmChainId || 8453) : undefined
    if (input.chain === "evm" && !evmChain) throw new Error("Unsupported EVM deployment network")
    const adapter = getChainAdapter(input.chain)
    if (!adapter.generationReady) throw new Error(`${adapter.name} generation is not enabled`)
    const generationPrompt = evmChain
      ? `${input.prompt}\n\nTarget EVM network: ${evmChain.name} (chain ID ${evmChain.id}).`
      : `${input.prompt}\n\nTarget ecosystem: ${adapter.name}. Language: ${adapter.language}. Toolchain: ${adapter.toolchain}. Initial deployment target: ${adapter.testNetwork}.`
    const preparedLocalDapp = user.isDemo && input.dappId ? localGetDapp(input.dappId) : undefined
    const preparedRows = !user.isDemo && input.dappId
      ? await supabaseRequest<Array<{ id: string; name: string; description: string | null; chain: string; contract_code: string | null; frontend_code: string | null; source_bundle_path: string | null; source_bundle_hash: string | null }>>({
        path: "dapps",
        query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}`, select: "id,name,description,chain,contract_code,frontend_code,source_bundle_path,source_bundle_hash", limit: "1" },
      })
      : []
    const preparedDapp = user.isDemo ? preparedLocalDapp : preparedRows[0] ? await hydrateDappSources(preparedRows[0]) : undefined
    if (input.dappId && (!preparedDapp || preparedDapp.chain !== input.chain)) throw new Error("The prepared generation could not be recovered")
    if (preparedDapp?.contract_code && preparedDapp.frontend_code) {
      return NextResponse.json({
        dappId: preparedDapp.id,
        name: preparedDapp.name,
        contract: preparedDapp.contract_code,
        frontend: preparedDapp.frontend_code,
        deployInstructions: "This recovered Dappster project is ready for review and deployment.",
        warnings: [],
        creditsRemaining: profile.credits,
        mode: user.isDemo ? "local" : "supabase",
      })
    }

    let creditsRemaining = profile.credits
    let jobId: string | undefined
    let workerToken: string | undefined
    if (!user.isDemo) {
      if (!input.dappId) throw new Error("Prepare a recoverable dApp before generation")
      const job = await createOrGetGenerationJob({ ownerId: user.id, dappId: input.dappId, chain: input.chain, evmChainId: evmChain?.id, prompt: input.prompt })
      jobId = job.id
      const claim = await claimGenerationJob(job.id, user.id)
      if (!claim.claimed) throw new Error(job.status === "completed" ? "Generation completed; reload the saved project" : "Generation is already processing. The saved project will update automatically.")
      workerToken = claim.workerToken
      if (job.credits_charged) {
        creditsRemaining = job.credits_remaining ?? profile.credits
      } else {
        creditsRemaining = activePro
          ? profile.credits
          : await verifyAndSpendCreditBurn(user.id, CREDIT_COSTS.generate, `${input.chain.toUpperCase()} dApp generation`, input.creditBurn)
        await markGenerationJobCharged(job.id, workerToken, creditsRemaining)
      }
    } else if (!activePro) {
      creditsRemaining = localSpend(user.id, CREDIT_COSTS.generate)
    }

    let generation
    try {
      // Do not bind model execution to the browser connection. Mobile browsers
      // may suspend the request; the leased job remains recoverable in Postgres.
      generation = await callAI("generate", generationPrompt, input.chain, { evmChainId: evmChain?.id })
    } catch (error) {
      if (jobId && workerToken) await failGenerationJob(jobId, workerToken, error instanceof Error ? error.message : "Generation failed")
      throw error
    }
    const name = generation.contractName || generation.programName || "Untitled dApp"
    let frontend = generation.frontend
    if (input.chain === "evm") {
      try {
        frontend = injectCompiledAbiIntoFrontend(frontend, compileSolidity(generation.contract, name, { chainId: evmChain?.id }).abi)
      } catch {
        // Compilation is repeated before deployment; keep generation recoverable if the model source needs editing.
      }
    }
    let dappId: string | undefined
    if (input.dappId) {
      dappId = input.dappId
      if (user.isDemo) {
        localUpdateDapp(input.dappId, { name, description: input.prompt, contract_code: generation.contract, frontend_code: frontend, deploy_status: "draft" })
      } else {
        let sourceMetadata: Record<string, unknown> = { contract_code: generation.contract, frontend_code: frontend }
        try {
          const stored = await storeDappSourceBundle(user.id, input.dappId, {
            contract: generation.contract,
            frontend,
            deployInstructions: generation.deployInstructions,
            warnings: generation.warnings,
          })
          sourceMetadata = {
            contract_code: null,
            frontend_code: null,
            source_bundle_path: stored.path,
            source_bundle_hash: stored.hash,
            source_bundle_bytes: stored.bytes,
            source_storage_version: 1,
          }
        } catch {
          // If Storage is temporarily unavailable, preserve the generated work
          // in the legacy columns and allow a later migration to move it.
        }
        await supabaseRequest({ path: "dapps", method: "PATCH", query: { id: `eq.${input.dappId}`, owner_id: `eq.${user.id}` }, body: { name, description: input.prompt, ...sourceMetadata, deploy_status: "draft", updated_at: new Date().toISOString() } })
      }
    } else {
      dappId = user.isDemo
        ? localCreateDapp({ owner_id: user.id, name, description: input.prompt, chain: input.chain, contract_code: generation.contract, frontend_code: frontend, audit_status: "none", deploy_status: "draft", is_listed: false, is_featured: false, tags: [] }).id
        : (await supabaseRequest<{ id: string }[]>({ path: "dapps", method: "POST", body: { owner_id: user.id, name, description: input.prompt, chain: input.chain, contract_code: generation.contract, frontend_code: frontend, audit_status: "none", deploy_status: "draft" } }))[0]?.id
    }
    if (jobId && workerToken) await completeGenerationJob(jobId, workerToken)
    return NextResponse.json({ dappId, name, contract: generation.contract, frontend, deployInstructions: generation.deployInstructions, warnings: generation.warnings, creditsRemaining, mode: user.isDemo ? "local" : "supabase" })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate this dApp"
    const status = message.includes("Authentication") || message.includes("session") ? 401 : message.includes("credits") ? 402 : message.includes("Rate limit") ? 429 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
