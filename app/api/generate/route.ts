import { NextResponse } from "next/server"
import { z } from "zod"
import { callAI } from "@/lib/ai"
import { CREDIT_COSTS, getCredits, hasActivePro } from "@/lib/credits"
import { optionalCreditBurnProofSchema, verifyAndSpendCreditBurn } from "@/lib/credit-burn"
import { enforceRateLimit } from "@/lib/rate-limit"
import { getRequestUser } from "@/lib/runtime"
import { localCreateDapp, localCredits, localGetDapp, localSpend, localUpdateDapp } from "@/lib/local-store"
import { supabaseRequest } from "@/lib/supabase"
import { getSupportedEvmChain } from "@/lib/evm-chains"
import { compileSolidity } from "@/lib/solidity"
import { injectCompiledAbiIntoFrontend } from "@/lib/frontend-abi"
import { CHAIN_IDS, getChainAdapter } from "@/lib/chain-adapters"
import {
  advanceGenerationPhase,
  claimGenerationPhase,
  createOrGetGenerationJob,
  failGenerationPhase,
  getGenerationJob,
  markGenerationJobCharged,
  type AiGenerationJob,
} from "@/lib/ai-generation-jobs"
import { enqueueAiGenerationPhase, isAiGenerationWorkerPhase } from "@/lib/ai-generation-queue"
import { hydrateDappSources } from "@/lib/source-storage"
import { getSolanaTesterEntitlement } from "@/lib/pasta-developer-tier"
import { getEvmTesterEntitlement } from "@/lib/pappardelle-tester-tier"

export const maxDuration = 60

const requestSchema = z.object({ prompt: z.string().min(12).max(4000), chain: z.enum(CHAIN_IDS), evmChainId: z.number().int().positive().optional(), includeAudit: z.boolean().optional().default(false), creditBurn: optionalCreditBurnProofSchema, dappId: z.string().uuid().optional() })

function queuedGenerationResponse(job: AiGenerationJob, creditsRemaining: number | null) {
  return NextResponse.json({
    dappId: job.dapp_id,
    jobId: job.id,
    status: job.status,
    phase: job.phase,
    creditsRemaining,
    mode: "supabase",
  }, { status: 202 })
}

async function ensureQueuedPhase(job: AiGenerationJob) {
  if (job.status !== "queued" || !isAiGenerationWorkerPhase(job.phase)) return
  try {
    await enqueueAiGenerationPhase({ jobId: job.id, ownerId: job.owner_id, phase: job.phase })
  } catch (error) {
    // Postgres is the durable source of truth. A retry of this endpoint or the
    // status endpoint republishes the same idempotent queue message.
    console.error("AI generation queue publication failed", error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    const input = requestSchema.parse(await request.json())
    const profile = user.isDemo
      ? { credits: localCredits(user.id), plan: "free" }
      : await getCredits(user.id)
    const activePro = hasActivePro(profile)
    const [solanaTester, evmTester] = user.isDemo ? [null, null] : await Promise.all([
      input.chain === "solana" ? getSolanaTesterEntitlement(user.id) : null,
      input.chain === "evm" ? getEvmTesterEntitlement(user.id) : null,
    ])
    const testerAccessMode = solanaTester?.eligible ? "solana-tester" : evmTester?.eligible ? "evm-tester" : null
    const unlimitedGeneration = activePro || Boolean(testerAccessMode)
    if (!unlimitedGeneration && profile.credits < CREDIT_COSTS.generate && !input.creditBurn) throw new Error(`You need ${CREDIT_COSTS.generate} credits for this action`)
    await enforceRateLimit(`generate:${user.id}`, unlimitedGeneration ? 60 : 10)

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

    if (user.isDemo) {
      const creditsRemaining = activePro ? profile.credits : localSpend(user.id, CREDIT_COSTS.generate)
      const generation = await callAI("generate", generationPrompt, input.chain, { evmChainId: evmChain?.id })
      const name = generation.contractName || generation.programName || "Untitled dApp"
      let frontend = generation.frontend
      if (input.chain === "evm") {
        try {
          frontend = injectCompiledAbiIntoFrontend(frontend, compileSolidity(generation.contract, name, { chainId: evmChain?.id }).abi)
        } catch {
          // Compilation is repeated before deployment; preserve recoverability.
        }
      }
      const dappId = input.dappId
        ? (localUpdateDapp(input.dappId, { name, description: input.prompt, contract_code: generation.contract, frontend_code: frontend, deploy_status: "draft" }), input.dappId)
        : localCreateDapp({ owner_id: user.id, name, description: input.prompt, chain: input.chain, contract_code: generation.contract, frontend_code: frontend, audit_status: "none", deploy_status: "draft", is_listed: false, is_featured: false, tags: [] }).id
      return NextResponse.json({ dappId, name, contract: generation.contract, frontend, deployInstructions: generation.deployInstructions, warnings: generation.warnings, creditsRemaining, mode: "local" })
    }

    if (!input.dappId) throw new Error("Prepare a recoverable dApp before generation")
    let job = await createOrGetGenerationJob({ ownerId: user.id, dappId: input.dappId, chain: input.chain, evmChainId: evmChain?.id, prompt: input.prompt })

    if (job.phase !== "submission") {
      await ensureQueuedPhase(job)
      return queuedGenerationResponse(job, job.credits_remaining ?? profile.credits)
    }

    const claim = await claimGenerationPhase(job.id, user.id, "submission", 300)
    if (!claim.claimed || !claim.job) {
      job = await getGenerationJob(job.id, user.id) || job
      await ensureQueuedPhase(job)
      return queuedGenerationResponse(job, job.credits_remaining ?? profile.credits)
    }

    let advanced = false
    try {
      const creditsRemaining = claim.job.credits_charged
        ? claim.job.credits_remaining ?? profile.credits
        : unlimitedGeneration
          ? profile.credits
          : await verifyAndSpendCreditBurn(user.id, CREDIT_COSTS.generate, `${input.chain.toUpperCase()} dApp generation`, input.creditBurn)
      if (!claim.job.credits_charged) await markGenerationJobCharged(job.id, claim.workerToken, creditsRemaining)
      job = await advanceGenerationPhase(job.id, claim.workerToken, "generation", null)
      advanced = true
      await ensureQueuedPhase(job)
      return queuedGenerationResponse(job, creditsRemaining)
    } catch (error) {
      if (!advanced) await failGenerationPhase(job.id, claim.workerToken, error instanceof Error ? error.message : "Generation submission failed")
      throw error
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate this dApp"
    const status = message.includes("Authentication") || message.includes("session") ? 401 : message.includes("credits") ? 402 : message.includes("Rate limit") ? 429 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
