import { handleCallback } from "@vercel/queue"
import { callAI, generateQueuedSolanaDraft, repairQueuedSolanaGeneration, reviewQueuedSolanaGeneration } from "./ai"
import {
  advanceGenerationPhase,
  claimGenerationPhase,
  completeGenerationJob,
  failGenerationPhase,
  getGenerationJob,
  type AiGenerationPayload,
} from "./ai-generation-jobs"
import {
  aiGenerationQueueMessageSchema,
  enqueueAiGenerationPhase,
  isAiGenerationWorkerPhase,
  type AiGenerationWorkerPhase,
} from "./ai-generation-queue"
import { persistAiGenerationResult } from "./ai-generation-persistence"
import { CHAIN_IDS, getChainAdapter } from "./chain-adapters"
import { getSupportedEvmChain } from "./evm-chains"
import type { Chain } from "@/types"

const WORKER_LEASE_SECONDS = 360
const MAX_PHASE_DELIVERIES = 3

function generationPrompt(chain: Chain, prompt: string, evmChainId: number | null) {
  if (chain === "evm") {
    const evmChain = getSupportedEvmChain(evmChainId || 8453)
    if (!evmChain) throw new Error("Unsupported EVM generation network")
    return `${prompt}\n\nTarget EVM network: ${evmChain.name} (chain ID ${evmChain.id}).`
  }
  const adapter = getChainAdapter(chain)
  return `${prompt}\n\nTarget ecosystem: ${adapter.name}. Language: ${adapter.language}. Toolchain: ${adapter.toolchain}. Initial deployment target: ${adapter.testNetwork}.`
}

async function processAiGenerationPhase(expectedPhase: AiGenerationWorkerPhase, payload: unknown) {
  const message = aiGenerationQueueMessageSchema.parse(payload)
  if (message.phase !== expectedPhase) throw new Error(`Queue phase mismatch: expected ${expectedPhase}, received ${message.phase}`)

  const current = await getGenerationJob(message.jobId, message.ownerId)
  if (!current || current.status === "completed" || (current.status === "failed" && current.phase_attempt_count >= MAX_PHASE_DELIVERIES)) return

  if (current.phase !== expectedPhase) {
    // Recover the outbox edge case where Postgres advanced successfully but
    // publishing the next queue message failed before the caller received it.
    if (current.status === "queued" && isAiGenerationWorkerPhase(current.phase)) {
      await enqueueAiGenerationPhase({ jobId: current.id, ownerId: current.owner_id, phase: current.phase })
    }
    return
  }

  const claim = await claimGenerationPhase(current.id, current.owner_id, expectedPhase, WORKER_LEASE_SECONDS)
  if (!claim.claimed || !claim.job) throw new Error(`Generation phase ${expectedPhase} is already leased`)

  let advanced = false
  try {
    const job = claim.job
    const chain = job.chain as Chain
    if (!CHAIN_IDS.includes(chain)) throw new Error(`Unsupported generation ecosystem: ${job.chain}`)
    const prompt = generationPrompt(chain, job.prompt, job.evm_chain_id)
    let nextPhase: AiGenerationWorkerPhase | null = null
    let result: AiGenerationPayload | null = job.generation_payload

    if (expectedPhase === "generation") {
      result = chain === "solana"
        ? await generateQueuedSolanaDraft(prompt)
        : await callAI("generate", prompt, chain, { evmChainId: job.evm_chain_id || undefined })
      nextPhase = chain === "solana" ? "review" : "save"
    } else if (expectedPhase === "review") {
      if (chain !== "solana" || !result) throw new Error("Solana review payload is unavailable")
      result = await reviewQueuedSolanaGeneration(prompt, result)
      nextPhase = "repair"
    } else if (expectedPhase === "repair") {
      if (chain !== "solana" || !result) throw new Error("Solana repair payload is unavailable")
      result = await repairQueuedSolanaGeneration(prompt, result)
      nextPhase = "save"
    } else {
      if (!result) throw new Error("Generation result is unavailable for persistence")
      await persistAiGenerationResult(job, result)
      await completeGenerationJob(job.id, claim.workerToken)
      return
    }

    await advanceGenerationPhase(job.id, claim.workerToken, nextPhase, result)
    advanced = true
    await enqueueAiGenerationPhase({ jobId: job.id, ownerId: job.owner_id, phase: nextPhase })
  } catch (error) {
    // When the database transition succeeded but send() failed, redelivering
    // this message repairs the missing next-phase publication idempotently.
    if (advanced) throw error
    const failed = await failGenerationPhase(
      claim.job.id,
      claim.workerToken,
      error instanceof Error ? error.message : `Generation phase ${expectedPhase} failed`,
    )
    if (failed.status !== "failed") throw error
  }
}

export function createAiGenerationQueueHandler(phase: AiGenerationWorkerPhase) {
  return handleCallback(
    async payload => processAiGenerationPhase(phase, payload),
    {
      visibilityTimeoutSeconds: WORKER_LEASE_SECONDS,
      retry: (_error, metadata) => metadata.deliveryCount >= MAX_PHASE_DELIVERIES
        ? { acknowledge: true }
        : { afterSeconds: Math.min(120, 10 * 2 ** Math.max(0, metadata.deliveryCount - 1)) },
    },
  )
}
