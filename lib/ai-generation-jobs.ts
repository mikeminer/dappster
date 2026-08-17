import { randomUUID } from "node:crypto"
import { supabaseRequest } from "./supabase"

export type AiGenerationJob = {
  id: string
  dapp_id: string
  owner_id: string
  chain: string
  evm_chain_id: number | null
  prompt: string
  status: "queued" | "processing" | "completed" | "failed"
  phase: AiGenerationPhase
  attempt_count: number
  phase_attempt_count: number
  max_attempts: number
  credits_charged: boolean
  credits_remaining: number | null
  generation_payload: AiGenerationPayload | null
  error: string | null
  worker_token: string | null
  lease_expires_at: string | null
  updated_at: string
}

export const AI_GENERATION_PHASES = ["submission", "generation", "review", "repair", "save", "completed"] as const
export type AiGenerationPhase = typeof AI_GENERATION_PHASES[number]

export type AiGenerationPayload = {
  contract: string
  contractName?: string
  programName?: string
  frontend: string
  deployInstructions: string
  warnings: string[]
}

export async function createOrGetGenerationJob(input: {
  ownerId: string
  dappId: string
  chain: string
  evmChainId?: number
  prompt: string
}) {
  const job = await supabaseRequest<AiGenerationJob>({
    path: "rpc/create_or_get_ai_generation_job",
    method: "POST",
    body: {
      p_owner_id: input.ownerId,
      p_dapp_id: input.dappId,
      p_chain: input.chain,
      p_evm_chain_id: input.evmChainId || null,
      p_prompt: input.prompt,
      p_idempotency_key: `generate:${input.ownerId}:${input.dappId}`,
    },
  })
  if (!job?.id) throw new Error("Generation job could not be created")
  return job
}

export async function claimGenerationJob(jobId: string, ownerId: string) {
  const workerToken = randomUUID()
  const result = await supabaseRequest<Record<string, unknown>>({
    path: "rpc/claim_ai_generation_job",
    method: "POST",
    body: { p_job_id: jobId, p_owner_id: ownerId, p_worker_token: workerToken, p_lease_seconds: 300 },
  })
  return { workerToken, claimed: Boolean(result && Object.keys(result).length) }
}

export async function getGenerationJob(jobId: string, ownerId: string) {
  const rows = await supabaseRequest<AiGenerationJob[]>({
    path: "ai_generation_jobs",
    query: { id: `eq.${jobId}`, owner_id: `eq.${ownerId}`, select: "*", limit: "1" },
  })
  return rows[0] || null
}

export async function getGenerationJobByDapp(dappId: string, ownerId: string) {
  const rows = await supabaseRequest<AiGenerationJob[]>({
    path: "ai_generation_jobs",
    query: { dapp_id: `eq.${dappId}`, owner_id: `eq.${ownerId}`, select: "*", order: "created_at.desc", limit: "1" },
  })
  return rows[0] || null
}

export async function claimGenerationPhase(jobId: string, ownerId: string, phase: AiGenerationPhase, leaseSeconds = 300) {
  const workerToken = randomUUID()
  const result = await supabaseRequest<AiGenerationJob | Record<string, never>>({
    path: "rpc/claim_ai_generation_phase",
    method: "POST",
    body: {
      p_job_id: jobId,
      p_owner_id: ownerId,
      p_phase: phase,
      p_worker_token: workerToken,
      p_lease_seconds: leaseSeconds,
    },
  })
  return {
    workerToken,
    claimed: Boolean(result && "id" in result),
    job: result && "id" in result ? result as AiGenerationJob : null,
  }
}

export async function advanceGenerationPhase(
  jobId: string,
  workerToken: string,
  nextPhase: AiGenerationPhase,
  payload: AiGenerationPayload | null,
) {
  const result = await supabaseRequest<AiGenerationJob>({
    path: "rpc/advance_ai_generation_phase",
    method: "POST",
    body: {
      p_job_id: jobId,
      p_worker_token: workerToken,
      p_next_phase: nextPhase,
      p_generation_payload: payload,
    },
  })
  if (!result?.id) throw new Error("Generation phase could not be advanced")
  return result
}

export async function failGenerationPhase(jobId: string, workerToken: string, error: string) {
  const result = await supabaseRequest<AiGenerationJob>({
    path: "rpc/fail_ai_generation_phase",
    method: "POST",
    body: { p_job_id: jobId, p_worker_token: workerToken, p_error: error.slice(0, 4000) },
  })
  if (!result?.id) throw new Error("Generation failure could not be recorded")
  return result
}

export async function markGenerationJobCharged(jobId: string, workerToken: string, creditsRemaining: number) {
  await supabaseRequest({
    path: "rpc/mark_ai_generation_job_charged",
    method: "POST",
    body: { p_job_id: jobId, p_worker_token: workerToken, p_credits_remaining: creditsRemaining },
  })
}

export async function completeGenerationJob(jobId: string, workerToken: string) {
  await supabaseRequest({
    path: "rpc/complete_ai_generation_job",
    method: "POST",
    body: { p_job_id: jobId, p_worker_token: workerToken },
  })
}

export async function failGenerationJob(jobId: string, workerToken: string, error: string) {
  await supabaseRequest({
    path: "rpc/fail_ai_generation_job",
    method: "POST",
    body: { p_job_id: jobId, p_worker_token: workerToken, p_error: error.slice(0, 4000) },
  })
}
