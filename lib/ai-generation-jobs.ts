import { randomUUID } from "node:crypto"
import { supabaseRequest } from "./supabase"

export type AiGenerationJob = {
  id: string
  dapp_id: string
  owner_id: string
  status: "queued" | "processing" | "completed" | "failed"
  attempt_count: number
  max_attempts: number
  credits_charged: boolean
  credits_remaining: number | null
  error: string | null
  worker_token: string | null
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
